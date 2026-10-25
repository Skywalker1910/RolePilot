from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def create_job(client, job):
    response = client.post("/api/jobs", json=job)
    assert response.status_code == 201, response.text
    return response.json()


def test_jobs_do_not_automatically_create_applications(client, job):
    create_job(client, job)
    result = client.get("/api/applications").json()
    assert result["total"] == 0


def test_apply_confirmation_is_persistent_and_history_is_complete(client, job):
    saved = create_job(client, job)
    started = client.post(f"/api/jobs/{saved['id']}/apply", json={}).json()
    application = started["application"]
    assert started["created"] is True
    assert application["current_status"] == "Pending Application"
    assert application["pending_confirmation"] is True
    assert len(client.get("/api/applications/pending-confirmations").json()) == 1

    deferred = client.post(
        f"/api/applications/{application['id']}/confirm", json={"action": "not_yet"}
    ).json()
    assert deferred["current_status"] == "Pending Application"
    assert deferred["applied_at"] is None
    assert deferred["pending_confirmation"] is False
    assert client.get("/api/applications/pending-confirmations").json() == []

    # The user can reopen the official portal from the persisted pending application.
    resumed = client.post(f"/api/jobs/{saved['id']}/apply", json={}).json()["application"]
    submitted = client.post(
        f"/api/applications/{application['id']}/confirm", json={"action": "applied"}
    ).json()
    assert submitted["current_status"] == "Applied"
    assert submitted["applied_at"]
    assert submitted["pending_confirmation"] is False
    assert [(h["previous_status"], h["new_status"]) for h in submitted["history"]] == [
        (None, "Pending Application"),
        ("Pending Application", "Applied"),
    ]
    assert resumed["id"] == submitted["id"]
    assert client.post(f"/api/jobs/{saved['id']}/apply", json={}).status_code == 409


def test_status_transitions_rejection_archive_restore_and_immutable_history(client, job):
    saved = create_job(client, job)
    application = client.post(f"/api/jobs/{saved['id']}/apply", json={}).json()["application"]
    application = client.post(
        f"/api/applications/{application['id']}/confirm", json={"action": "applied"}
    ).json()
    changed = client.post(
        f"/api/applications/{application['id']}/status",
        json={"new_status": "Technical Interview", "custom_stage_label": "Round 2"},
    ).json()
    assert changed["custom_stage_label"] == "Round 2"
    rejected = client.post(
        f"/api/applications/{application['id']}/status", json={"new_status": "Rejected"}
    ).json()
    assert rejected["archived_at"]
    assert client.get("/api/applications?archived=true").json()["total"] == 1
    restored = client.post(
        f"/api/applications/{application['id']}/archive",
        json={"archived": False, "expected_revision": rejected["revision"]},
    ).json()
    assert restored["archived_at"] is None
    assert restored["current_status"] == "Rejected"
    with client.engine.connect() as connection:
        with pytest.raises(IntegrityError, match="append-only"):
            connection.execute(
                text("UPDATE application_status_history SET notes='edited' WHERE id=1")
            )
        connection.rollback()
        with pytest.raises(IntegrityError, match="append-only"):
            connection.execute(text("DELETE FROM application_status_history WHERE id=1"))
        connection.rollback()


def test_remind_later_followup_task_and_accurate_metrics(client, job):
    saved = create_job(client, job)
    application = client.post(f"/api/jobs/{saved['id']}/apply", json={}).json()["application"]
    reminded = client.post(
        f"/api/applications/{application['id']}/confirm", json={"action": "remind_later"}
    ).json()
    assert reminded["pending_confirmation"]
    assert reminded["confirmation_remind_at"] > datetime.now(UTC).isoformat()
    application = client.post(
        f"/api/applications/{application['id']}/confirm", json={"action": "applied"}
    ).json()
    response = client.post(
        f"/api/applications/{application['id']}/status", json={"new_status": "Recruiter Screening"}
    )
    assert response.status_code == 200
    task = client.post(
        f"/api/applications/{application['id']}/tasks",
        json={"title": "Follow up with recruiter", "due_at": datetime.now(UTC).isoformat()},
    )
    assert task.status_code == 201
    metrics = client.get("/api/application-metrics").json()
    assert metrics["applications_total"] == 1
    assert metrics["submitted"] == 1
    assert metrics["response_rate"] == 100
    assert metrics["follow_ups_due"] == 1
    complete = client.patch(
        f"/api/applications/{application['id']}/tasks/{task.json()['id']}?completed=true"
    )
    assert complete.status_code == 200
    assert client.get("/api/application-metrics").json()["follow_ups_due"] == 0


def test_manual_application_and_unique_job_constraint(client, job):
    saved = create_job(client, job)
    response = client.post(
        "/api/applications/manual", json={"job_id": saved["id"], "current_status": "Applied"}
    )
    assert response.status_code == 201
    assert response.json()["applied_at"] is None
    assert response.json()["history"][0]["new_status"] == "Applied"
    assert client.post("/api/applications/manual", json={"job_id": saved["id"]}).status_code == 409
