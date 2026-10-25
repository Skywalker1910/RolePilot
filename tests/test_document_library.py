import hashlib
import os
import shutil
import subprocess

import pytest
from alembic import command
from alembic.config import Config
from app.library import file_metadata, safe_path, validate_root


@pytest.fixture
def library_tree(tmp_path):
    root = tmp_path / "collection"
    files = {
        "Resumes/resume_01Jan_v1_aptos/resume.pdf": b"%PDF-1.4 synthetic resume",
        "Resumes/resume_01Jan_v1_aptos/content.tex": b"synthetic source",
        "Resumes/_legacy/notes.md": b"synthetic notes",
        "Resumes/resume_02Feb_v2/resume.docx": b"synthetic format fixture",
        "cover_letters/ExampleCo_Data_Analyst/letter.pdf": b"%PDF-1.4 synthetic letter",
        "cover_letters/Other/draft.txt": b"synthetic draft",
        "cover_letters/Other/old.doc": b"synthetic legacy format",
        "Resumes/resume_02Feb_v2/build.log": b"ignore build",
        ".claude/private.md": b"excluded configuration",
        "src/content.tex": b"excluded source",
        "root.pdf": b"outside indexed directories",
    }
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return root


def reconnect(client, root, approve=False):
    config = client.get("/api/document-library").json()
    return client.put(
        "/api/document-library",
        json={
            "root_path": str(root),
            "expected_revision": config["revision"],
            "accept_unverified": approve,
        },
    )


def inventory(client):
    return client.get("/api/documents").json()["items"]


def test_index_is_read_only_and_idempotent(client, library_tree):
    before = {
        p.relative_to(library_tree).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in library_tree.rglob("*")
        if p.is_file()
    }
    response = reconnect(client, library_tree)
    assert response.status_code == 200, response.text
    documents = inventory(client)
    assert len(documents) == 7
    assert all(d["status"] == "Unreviewed" for d in documents)
    resume = next(d for d in documents if d["filename"] == "resume.pdf")
    assert resume["version_label"] == "resume_01Jan_v1_aptos"
    assert resume["document_type"] == "Resume"
    source = next(d for d in documents if d["filename"] == "content.tex")
    assert source["document_type"] == "Supporting Document"
    letter = next(d for d in documents if d["filename"] == "letter.pdf")
    assert letter["folder_hint"] == "ExampleCo_Data_Analyst"
    assert letter["company_id"] is None and letter["role_label"] is None
    assert "Resumes/_legacy" in response.json()["scan_summary"]["folders"]
    assert client.post("/api/document-library/scan").status_code == 200
    assert {d["id"] for d in inventory(client)} == {d["id"] for d in documents}
    after = {
        p.relative_to(library_tree).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in library_tree.rglob("*")
        if p.is_file()
    }
    assert before == after
    for d in documents:
        assert len(client.get(f"/api/documents/{d['id']}").json()["revisions"]) == 1


def test_changes_missing_and_restored(client, library_tree):
    reconnect(client, library_tree)
    document = next(d for d in inventory(client) if d["filename"] == "resume.pdf")
    path = library_tree / document["relative_path"]
    path.write_bytes(b"%PDF-changed")
    client.post("/api/document-library/scan")
    changed = client.get(f"/api/documents/{document['id']}").json()
    assert changed["file_hash"] == hashlib.sha256(b"%PDF-changed").hexdigest()
    assert changed["file_hash"] != document["file_hash"]
    assert len(changed["revisions"]) == 2
    path.unlink()
    client.post("/api/document-library/scan")
    assert client.get(f"/api/documents/{document['id']}").json()["is_missing"]
    path.write_bytes(b"%PDF-changed")
    client.post("/api/document-library/scan")
    restored = client.get(f"/api/documents/{document['id']}").json()
    assert not restored["is_missing"]
    assert len(restored["revisions"]) == 2


def test_identical_contents_and_move_ambiguity(client, library_tree):
    reconnect(client, library_tree)
    original = next(d for d in inventory(client) if d["filename"] == "resume.pdf")
    source = library_tree / original["relative_path"]
    shutil.copyfile(source, source.with_name("copy.pdf"))
    client.post("/api/document-library/scan")
    assert len(inventory(client)) == 8
    source.rename(source.with_name("renamed.pdf"))
    report = client.post("/api/document-library/scan").json()["scan_summary"]
    assert client.get(f"/api/documents/{original['id']}").json()["is_missing"]
    candidates = next(c for c in report["move_candidates"] if c["document_id"] == original["id"])
    assert len(candidates["candidate_paths"]) == 2
    assert len(inventory(client)) == 9


def test_relocation_keeps_ids_and_old_folder(client, library_tree, tmp_path):
    reconnect(client, library_tree)
    before = {d["relative_path"]: d["id"] for d in inventory(client)}
    destination = tmp_path / "inside-rolepilot" / "documents"
    shutil.copytree(library_tree, destination)
    report = client.post(
        "/api/document-library/validate", json={"root_path": str(destination)}
    ).json()
    assert report["matched"] == 7 and not report["requires_approval"]
    assert reconnect(client, destination).status_code == 200
    assert before == {d["relative_path"]: d["id"] for d in inventory(client)}
    assert library_tree.exists()
    assert client.get("/api/document-library").json()["root_path"] == str(destination)


def test_relocation_approval(client, library_tree, tmp_path):
    reconnect(client, library_tree)
    destination = tmp_path / "different"
    (destination / "Resumes").mkdir(parents=True)
    report = client.post(
        "/api/document-library/validate", json={"root_path": str(destination)}
    ).json()
    assert report["requires_approval"] and report["missing"] == 7
    assert reconnect(client, destination).status_code == 409
    assert client.get("/api/document-library").json()["root_path"] == str(library_tree)
    assert reconnect(client, destination, approve=True).status_code == 200
    assert len(inventory(client)) == 7


def test_unavailable_root_preserves_records(client, library_tree):
    reconnect(client, library_tree)
    library_tree.rename(library_tree.with_name("temporarily-moved"))
    result = client.post("/api/document-library/scan").json()
    assert not result["available"] and result["last_error"]
    assert all(not d["is_missing"] for d in inventory(client))
    assert reconnect(client, library_tree).status_code == 422


def test_manual_metadata_and_stale_edits(client, library_tree, job):
    reconnect(client, library_tree)
    saved_job = client.post("/api/jobs", json=job).json()
    d = next(d for d in inventory(client) if d["filename"] == "resume.pdf")
    body = {
        "expected_revision": d["revision"],
        "document_type": "Resume",
        "status": "Master",
        "version_label": "My verified master",
        "company_id": saved_job["company_id"],
        "job_id": saved_job["id"],
        "role_label": "Engineer",
        "notes": "Manual correction",
    }
    result = client.put(f"/api/documents/{d['id']}/metadata", json=body)
    assert result.status_code == 200, result.text
    assert client.put(f"/api/documents/{d['id']}/metadata", json=body).status_code == 409
    client.post("/api/document-library/scan")
    actual = client.get(f"/api/documents/{d['id']}").json()
    assert actual["status"] == "Master" and actual["version_label"] == "My verified master"
    assert client.get("/api/documents?q=Fictional%20Orbit").json()["total"] == 1
    assert client.get("/api/documents?folder=cover_letters&format=pdf").json()["total"] == 1
    assert (
        client.put(
            f"/api/documents/{d['id']}/metadata",
            json={**body, "expected_revision": actual["revision"], "status": "Submitted"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "relative",
    [
        "../secret.txt",
        "Resumes/../../secret.txt",
        "Resumes/../cover_letters/x.pdf",
        "C:/secret.pdf",
        "/Resumes/a.pdf",
        "Resumes\\a.pdf",
        "src/content.tex",
        ".claude/file.md",
        "Resumes/.claude/file.md",
        "Resumes/src/content.tex",
        "Resumes/a.pdf:stream",
    ],
)
def test_traversal_and_exclusions(library_tree, relative):
    with pytest.raises((ValueError, FileNotFoundError)):
        safe_path(validate_root(str(library_tree)), relative)


def test_junction_or_symlink_not_followed(client, library_tree, tmp_path):
    outside = tmp_path / "private"
    outside.mkdir()
    (outside / "secret.txt").write_text("private")
    link = library_tree / "Resumes" / "linked"
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True
        )
        if result.returncode:
            pytest.skip("Junction creation unavailable on this filesystem")
    else:
        link.symlink_to(outside, target_is_directory=True)
    try:
        with pytest.raises(ValueError, match="links and junctions"):
            safe_path(validate_root(str(library_tree)), "Resumes/linked/secret.txt")
        result = reconnect(client, library_tree)
        assert result.status_code == 200
        assert not any(d["filename"] == "secret.txt" for d in inventory(client))
        assert result.json()["scan_summary"]["issues"]
    finally:
        if os.name == "nt":
            os.rmdir(link)  # Remove only the synthetic test junction, not its target.
        else:
            link.unlink()


def test_validation_and_size_limit(library_tree, monkeypatch):
    from app import library

    with pytest.raises(ValueError):
        validate_root("relative/folder")
    monkeypatch.setattr(library, "MAX_FILE_BYTES", 1)
    with pytest.raises(ValueError, match="64 MB"):
        file_metadata(validate_root(str(library_tree)), "Resumes/_legacy/notes.md")


def test_persistence(client, library_tree):
    reconnect(client, library_tree)
    ids = {d["id"] for d in inventory(client)}
    client.engine.dispose()
    assert client.get("/api/document-library").json()["root_path"] == str(library_tree)
    assert {d["id"] for d in inventory(client)} == ids


def test_account_migration_refuses_unsafe_downgrade_without_changing_jobs(client, job):
    created = client.post("/api/jobs", json=job).json()
    with pytest.raises(RuntimeError, match="cannot be downgraded safely"):
        command.downgrade(Config("alembic.ini"), "c12a_source_rows")
    assert client.get(f"/api/jobs/{created['id']}").json()["job_title"] == job["job_title"]
    assert client.get("/api/document-library").status_code == 200
