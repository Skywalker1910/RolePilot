import pytest
from app.schemas import JobInput
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def test_search_filters_edit_archive_restore(client, job):
    job |= {
        "city": "Raleigh",
        "salary_max": 130000,
        "minimum_experience": 2,
        "remote_type": "hybrid",
        "full_description": "<script>alert(1)</script>",
    }
    saved = client.post("/api/jobs", json=job).json()
    assert client.get("/api/jobs?q=python&remote_type=Hybrid").json()["total"] == 1
    assert client.get("/api/jobs?location=raleigh&salary_min=100000").json()["total"] == 1
    assert client.get("/api/jobs?experience_max=1").json()["total"] == 0
    assert client.get("/api/jobs?skill=SQL").json()["total"] == 1
    assert client.get("/api/jobs?q=%25").json()["total"] == 0
    archived = client.post(
        f"/api/jobs/{saved['id']}/archive", json={"archived": True, "expected_revision": 1}
    ).json()
    assert archived["archived_at"]
    assert client.get("/api/jobs").json()["total"] == 0
    assert client.get("/api/jobs?archived=true&q=Engineer").json()["total"] == 1
    restored = client.post(
        f"/api/jobs/{saved['id']}/archive", json={"archived": False, "expected_revision": 2}
    ).json()
    assert restored["archived_at"] is None
    assert restored["revision"] == 3
    assert client.get("/api/overview").json()["total_jobs"] == 1


def test_optimistic_edit_and_identity_uniqueness(client, job):
    saved = client.post("/api/jobs", json=job).json()
    assert client.post("/api/jobs", json=job).status_code == 409
    data = {k: saved[k] for k in JobInput.model_fields}
    assert (
        client.put(
            f"/api/jobs/{saved['id']}",
            json={
                "job": data | {"job_title": "Corrected"},
                "expected_revision": 1,
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/jobs/{saved['id']}",
            json={
                "job": data,
                "expected_revision": 1,
            },
        ).status_code
        == 409
    )
    assert client.get("/api/jobs/9999").status_code == 404


def test_database_rejects_invalid_ranges_and_foreign_keys(client, job):
    saved = client.post("/api/jobs", json=job).json()
    with client.engine.connect() as connection:
        with pytest.raises(IntegrityError):
            connection.execute(
                text("UPDATE jobs SET salary_min=200, salary_max=100 WHERE id=:id"),
                {"id": saved["id"]},
            )
        connection.rollback()
        with pytest.raises(IntegrityError):
            connection.execute(
                text("UPDATE jobs SET company_id=99999 WHERE id=:id"), {"id": saved["id"]}
            )
        connection.rollback()
