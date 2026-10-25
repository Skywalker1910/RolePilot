import csv
import io

import openpyxl
import pytest
from app.imports import parse_file
from app.main import spreadsheet_safe
from app.schemas import JobInput, safe_url
from sqlalchemy import text


def upload(client, rows, name="jobs.csv"):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    response = client.post(
        "/api/imports/preview", files={"file": (name, stream.getvalue().encode())}
    )
    assert response.status_code == 200, response.text
    return response.json()


def commit_rows(client, preview, actions=None):
    decisions = actions or [
        {"row_number": r["row_number"], "action": "skip" if r["errors"] else "insert"}
        for r in preview["rows"]
    ]
    return client.post(f"/api/imports/{preview['id']}/commit", json={"decisions": decisions})


@pytest.fixture
def row():
    return {
        "Company": "Fictional Comet",
        "Title": "Engineer",
        "Job URL": "https://comet.example/jobs/12",
        "Skills": "Python; SQL; python",
        "salary_min": "",
        "salary_max": "",
        "minimum_experience": "",
        "posted_at": "2026-10-01",
        "Unsupported note": "preserve me",
    }


def test_preview_commit_and_provenance(client, row):
    preview = upload(client, [row])
    assert preview["mapping"]["Unsupported note"] == ""
    assert preview["rows"][0]["data"]["minimum_experience"] is None
    assert client.get("/api/jobs").json()["total"] == 0
    result = commit_rows(client, preview)
    assert result.status_code == 200, result.text
    assert result.json()["inserted"] == 1
    saved = client.get("/api/jobs").json()["items"][0]
    assert saved["company_job_id"] is None
    assert saved["required_skills"] == ["Python", "SQL"]
    detail = client.get(f"/api/jobs/{saved['id']}").json()
    assert detail["provenance"][0]["original_fields"]["Unsupported note"] == "preserve me"
    assert commit_rows(client, preview).status_code == 409
    with client.engine.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM skills")) == 2


@pytest.mark.parametrize(
    "patch",
    [
        {"Job URL": ""},
        {"Job URL": "not-a-url"},
        {"Job URL": "javascript:alert(1)"},
        {"salary_min": "150000", "salary_max": "90000"},
        {"posted_at": "next Tuesday"},
        {"minimum_experience": "-1"},
        {"salary_min": "nan"},
        {"Company": ""},
    ],
)
def test_invalid_rows_are_reviewable_and_skippable(client, row, patch):
    preview = upload(client, [row | patch])
    assert preview["rows"][0]["errors"]
    response = commit_rows(client, preview)
    assert response.status_code == 200
    assert response.json()["rejected"] == 1
    assert client.get("/api/jobs").json()["total"] == 0


def test_correct_row_and_manual_mapping(client, row):
    row["Career page"] = row.pop("Job URL")
    row["salary_min"] = "200k"
    row["salary_max"] = "100k"
    preview = upload(client, [row])
    assert preview["rows"][0]["errors"]
    preview["mapping"]["Career page"] = "canonical_job_url"
    review = client.post(
        f"/api/imports/{preview['id']}/review",
        json={"mapping": preview["mapping"], "corrections": {"2": {"salary_max": 250000}}},
    )
    assert review.status_code == 200, review.text
    assert review.json()["rows"][0]["errors"] == []
    assert commit_rows(client, review.json()).status_code == 200
    assert client.get("/api/jobs").json()["items"][0]["salary_min"] == 200000


def test_duplicate_rows_and_exact_match(client, row):
    preview = upload(client, [row, row])
    assert "Duplicate identity" in preview["rows"][1]["errors"][0]
    assert commit_rows(client, preview).json()["inserted"] == 1
    again = upload(client, [row])
    assert again["rows"][0]["duplicate_kind"] == "exact"
    assert commit_rows(client, again).status_code == 409


def test_requisition_priority_and_uncertain_duplicate(client, row):
    first = row | {"company_job_id": " AB-1 "}
    assert commit_rows(client, upload(client, [first])).status_code == 200
    same_req = upload(
        client, [first | {"Job URL": "https://comet.example/new", "company_job_id": "ab-1"}]
    )
    assert same_req["rows"][0]["duplicate_kind"] == "exact"
    possible = upload(client, [row | {"Job URL": "https://comet.example/jobs/other"}])
    assert possible["rows"][0]["duplicate_kind"] == "possible"
    assert commit_rows(client, possible).status_code == 409
    result = commit_rows(
        client,
        possible,
        [
            {"row_number": 2, "action": "insert", "approve_conflicts": True},
        ],
    )
    assert result.status_code == 200, result.text
    assert client.get("/api/jobs").json()["total"] == 2


def test_edited_fields_conflicts_and_stale_preview(client, row):
    commit_rows(client, upload(client, [row]))
    job = client.get("/api/jobs").json()["items"][0]
    data = {k: job[k] for k in JobInput.model_fields}
    data["job_title"] = "Locally corrected title"
    updated = client.put(
        f"/api/jobs/{job['id']}",
        json={
            "job": data,
            "expected_revision": job["revision"],
        },
    ).json()
    preview = upload(client, [row])
    conflict = preview["rows"][0]["conflicts"][str(job["id"])]["job_title"]
    assert conflict["locally_edited"] is True
    decision = {
        "row_number": 2,
        "action": "update",
        "target_id": job["id"],
        "expected_revision": updated["revision"],
    }
    assert commit_rows(client, preview, [decision]).status_code == 409
    client.put(
        f"/api/jobs/{job['id']}",
        json={
            "job": data | {"full_description": "New local edit"},
            "expected_revision": updated["revision"],
        },
    )
    assert commit_rows(client, preview, [decision | {"approve_conflicts": True}]).status_code == 409
    refreshed = client.post(
        f"/api/imports/{preview['id']}/review",
        json={
            "mapping": preview["mapping"],
        },
    ).json()
    revision = refreshed["rows"][0]["candidates"][0]["revision"]
    result = commit_rows(
        client,
        refreshed,
        [
            decision
            | {
                "approve_conflicts": True,
                "expected_revision": revision,
            }
        ],
    )
    assert result.status_code == 200, result.text
    assert result.json()["updated"] == 1


def test_transaction_rolls_back_earlier_rows_on_failure(client, row):
    existing = row | {"Job URL": "https://comet.example/existing"}
    commit_rows(client, upload(client, [existing]))
    preview = upload(
        client,
        [
            row | {"Title": "New separate role"},
            existing,
        ],
    )
    response = commit_rows(
        client,
        preview,
        [
            {"row_number": 2, "action": "insert"},
            {"row_number": 3, "action": "insert"},
        ],
    )
    assert response.status_code == 409
    assert client.get("/api/jobs").json()["total"] == 1
    assert len(client.get("/api/imports").json()) == 1


def test_workbook_template_and_formula_text(client):
    response = client.get("/api/template.xlsx?sample=true")
    assert response.status_code == 200
    rows, mapping = parse_file("example.xlsx", response.content)
    assert "fictional" in rows[0]["company_name"]
    assert mapping["required_skills"] == "required_skills"
    workbook = openpyxl.load_workbook(io.BytesIO(response.content))
    workbook.active["T2"] = '=HYPERLINK("https://evil.example","click")'
    stream = io.BytesIO()
    workbook.save(stream)
    preview = client.post(
        "/api/imports/preview", files={"file": ("jobs.xlsx", stream.getvalue())}
    ).json()
    assert preview["rows"][0]["data"]["full_description"].startswith("=HYPERLINK")
    assert spreadsheet_safe(" =SUM(A1)") == "' =SUM(A1)"
    assert spreadsheet_safe("@formula") == "'@formula"


def test_file_errors(client):
    assert (
        client.post("/api/imports/preview", files={"file": ("file.xls", b"x")}).status_code == 422
    )
    assert (
        client.post("/api/imports/preview", files={"file": ("file.xlsx", b"x")}).status_code == 422
    )
    with pytest.raises(ValueError, match="Duplicate column"):
        parse_file("x.csv", b"company,company\na,b")


def test_official_schema_tags_and_blank_identity_values(client):
    stream = io.StringIO()
    writer = csv.DictWriter(
        stream,
        fieldnames=[
            "company_name",
            "job_title",
            "job_id",
            "job_url",
            "location",
            "work_mode",
            "experience_min",
            "required_skills",
            "preferred_skills",
            "job_keywords",
            "verification_status",
        ],
    )
    writer.writeheader()
    writer.writerow(
        {
            "company_name": "  Fictional  Labs ",
            "job_title": "Researcher",
            "job_id": "00042-A",
            "job_url": "https://labs.example/jobs/42",
            "location": "Boston, MA",
            "work_mode": "Remote",
            "experience_min": "",
            "required_skills": "pytorch; sklearn",
            "preferred_skills": "AWS",
            "job_keywords": "LLMs",
            "verification_status": "Verified",
        }
    )
    preview = client.post(
        "/api/imports/preview", files={"file": ("jobs.csv", stream.getvalue().encode())}
    ).json()
    row = preview["rows"][0]
    assert not row["errors"]
    assert row["data"]["company_job_id"] == "00042-A"
    assert row["data"]["minimum_experience"] is None
    assert row["data"]["required_skills"] == ["pytorch", "sklearn"]
    assert commit_rows(client, preview).status_code == 200
    saved = client.get("/api/jobs").json()["items"][0]
    assert saved["required_skills"] == ["PyTorch", "scikit-learn"]
    assert saved["preferred_skills"] == ["AWS"]
    assert saved["job_keywords"] == ["LLMs"]
    assert saved["verification_status"] == "Verified"


def test_jobs_worksheet_template_and_company_crud(client):
    template = openpyxl.load_workbook(io.BytesIO(client.get("/api/template.xlsx").content))
    assert template.sheetnames == ["jobs", "metadata"]
    assert [cell.value for cell in template["jobs"][1]][:4] == [
        "company_name",
        "job_title",
        "job_id",
        "job_url",
    ]
    company = client.post("/api/companies", json={"name": "Fictional Labs", "industry": "Research"})
    assert company.status_code == 201
    assert client.post("/api/companies", json={"name": " fictional   labs "}).status_code == 409
    detail = client.get(f"/api/companies/{company.json()['id']}").json()
    assert detail["industry"] == "Research"


def test_workbook_without_jobs_sheet_can_be_selected(client):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Company Export"
    sheet.append(["company_name", "job_title", "job_url"])
    sheet.append(["Fictional North", "Engineer", "https://north.example/careers/1"])
    stream = io.BytesIO()
    workbook.save(stream)
    content = stream.getvalue()
    missing = client.post("/api/imports/preview", files={"file": ("export.xlsx", content)})
    assert missing.status_code == 409
    assert missing.json()["detail"]["worksheets"] == ["Company Export"]
    selected = client.post(
        "/api/imports/preview",
        files={"file": ("export.xlsx", content)},
        data={"worksheet_name": "Company Export"},
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["worksheet_name"] == "Company Export"
    assert selected.json()["rows"][0]["data"]["company_name"] == "Fictional North"
    with pytest.raises(ValueError, match="empty"):
        parse_file("x.csv", b"")


def test_url_canonicalization():
    assert (
        safe_url("HTTPS://EXAMPLE.COM/jobs/1?utm_source=x&req=2#top")
        == "https://example.com/jobs/1?req=2"
    )
    with pytest.raises(ValueError):
        safe_url("https://user:secret@example.com/jobs")


def test_physical_source_rows_and_verbatim_source(client):
    content = (
        "Company,Title,Job URL,Description\n"
        "\n"
        "Fictional Space,Engineer,https://space.example/jobs/1,  original spaces  \n"
    )
    response = client.post("/api/imports/preview", files={"file": ("source.csv", content.encode())})
    assert response.status_code == 200
    preview = response.json()
    assert preview["rows"][0]["row_number"] == 3
    assert preview["rows"][0]["raw"]["Description"] == "  original spaces  "
    # Unrecognized Description capitalization auto-maps, but original text is untouched.
    assert preview["rows"][0]["data"]["full_description"] == "original spaces"
    assert commit_rows(client, preview).status_code == 200
    job = client.get("/api/jobs").json()["items"][0]
    source = client.get(f"/api/jobs/{job['id']}").json()["provenance"][0]
    assert source["row_number"] == 3


def test_malformed_http_hostname():
    with pytest.raises(ValueError):
        safe_url("https://not a valid host/jobs")
