from sqlalchemy import text


def test_health_migration_and_pragmas(client):
    assert client.get("/api/health").json()["status"] == "ok"
    with client.engine.connect() as conn:
        assert conn.scalar(text("PRAGMA foreign_keys")) == 1
        assert conn.scalar(text("PRAGMA journal_mode")) == "wal"


def test_persistence_and_unknown_values(client, job):
    response = client.post("/api/jobs", json=job)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["salary_min"] is None
    assert data["minimum_experience"] is None
    assert data["required_skills"] == ["Python", "SQL"]
    client.engine.dispose()  # close connections; reopen the same on-disk database
    assert client.get(f"/api/jobs/{data['id']}").json()["job_title"] == job["job_title"]


def test_security(client, job):
    assert (
        client.post("/api/jobs", json=job, headers={"origin": "https://evil.example"}).status_code
        == 403
    )
    assert client.get("/api/jobs", headers={"host": "evil.example"}).status_code == 400
    job["canonical_job_url"] = "javascript:alert(1)"
    assert client.post("/api/jobs", json=job).status_code == 422
    assert (
        client.post(
            "/api/jobs",
            json=job,
            headers={"origin": "http://127.0.0.1:5174"},
        ).status_code
        == 422
    )
