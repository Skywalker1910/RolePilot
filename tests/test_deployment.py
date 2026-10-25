"""Synthetic deployment failure tests: no services, credentials or personal DBs."""

import hashlib
import io
import json
import os
import subprocess
import tarfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from deploy.scripts import deploy_host as host
from deploy.scripts import release
from scripts.repository_audit import unsafe_path


@pytest.mark.parametrize(
    "name",
    [
        "data/rolepilot.db",
        "tmp/private.txt",
        "backend/.env.production",
        "documents/cv.docx",
        "snapshot.sqlite3-wal",
        "keys/server.pem",
        "backups/db.tar.gz",
    ],
)
def test_publication_blocks_private_paths(name):
    assert unsafe_path(name)


@pytest.mark.parametrize(
    "name",
    [
        "backend/app/db.py",
        "docs/document-library.md",
        "backend/migrations/env.py",
        "deploy/rolepilot.env.example",
        "frontend/package-lock.json",
    ],
)
def test_publication_keeps_legitimate_source(name):
    assert not unsafe_path(name)


def test_gitignore_excludes_runtime_but_preserves_examples_and_schema():
    root = Path(__file__).resolve().parents[1]
    private = [
        ".env",
        ".env.production",
        "data/rolepilot.db",
        "data/rolepilot.db-wal",
        "data/rolepilot.db-shm",
        "documents/resume.docx",
        "backups/db.tar.gz",
        "snapshots/submitted.pdf",
        "uploads/letter.docx",
        "tmp/private.json",
        ".tmp/npm-cache/index-v5/registry.json",
        ".venv/pyvenv.cfg",
        "frontend/node_modules/package/index.js",
        "frontend/dist/index.html",
        "logs/runtime.log",
        ".ssh/id_ed25519",
        "server.pem",
        ".aws/credentials",
        "config.local.json",
    ]
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "--stdin", "-z"],
        input=("\0".join(private) + "\0").encode(),
        cwd=root,
        capture_output=True,
        check=True,
    )
    assert set(result.stdout.decode().rstrip("\0").split("\0")) == set(private)
    safe = [
        ".env.example",
        ".env.production.example",
        "deploy/rolepilot.env.example",
        "backend/migrations/env.py",
        "backend/app/models.py",
        "docs/architecture.md",
    ]
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "--stdin", "-z"],
        input=("\0".join(safe) + "\0").encode(),
        cwd=root,
        capture_output=True,
    )
    assert not result.stdout


def bundle(tmp_path, extra=None):
    files = {
        "requirements.lock": b"",
        "alembic.ini": b"",
        "backend/app/main.py": b"safe",
        "frontend/dist/index.html": b"<html>synthetic</html>",
    }
    files.update(extra or {})
    manifest = {
        "commit": "a" * 40,
        "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
    }
    files["RELEASE.json"] = json.dumps(manifest).encode()
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            tar.addfile(member, io.BytesIO(content))
    return archive


def test_release_identity_and_isolation(tmp_path):
    archive = bundle(tmp_path)
    persistent = tmp_path / "data"
    persistent.mkdir()
    sentinel = persistent / "rolepilot.db"
    sentinel.write_bytes(b"untouched synthetic bytes")
    destination = tmp_path / "releases" / ("a" * 40)
    destination.parent.mkdir()
    release.unpack(archive, destination, "a" * 40, release.digest(archive))
    assert sentinel.read_bytes() == b"untouched synthetic bytes"
    assert not (destination / "data").exists()
    with pytest.raises(ValueError, match="already exists"):
        release.unpack(archive, destination, "a" * 40, release.digest(archive))
    with pytest.raises(ValueError, match="checksum"):
        release.unpack(archive, tmp_path / "bad", "a" * 40, "0" * 64)
    with pytest.raises(ValueError, match="commit"):
        release.unpack(archive, tmp_path / "wrong", "b" * 40, release.digest(archive))


@pytest.mark.parametrize(
    "name",
    [
        "../rolepilot.db",
        "/etc/passwd",
        "data/rolepilot.db",
        "backend/app/../../oops",
        "backend/app/.env",
        "frontend/dist/secret.key",
    ],
)
def test_archive_rejects_unsafe_paths_before_extraction(tmp_path, name):
    archive = bundle(tmp_path, {name: b"bad"})
    with pytest.raises(ValueError, match="Unsafe"):
        release.unpack(archive, tmp_path / "candidate", "a" * 40, release.digest(archive))
    assert not (tmp_path / "candidate").exists()


def test_archive_rejects_links(tmp_path):
    archive = tmp_path / "link.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        member = tarfile.TarInfo("backend/app/link")
        member.type = tarfile.SYMTYPE
        member.linkname = "/var/lib/rolepilot"
        tar.addfile(member)
    with pytest.raises(ValueError, match="Unsafe"):
        release.unpack(archive, tmp_path / "candidate", "a" * 40, release.digest(archive))


def test_release_retention_never_deletes_persistent_or_active_paths(tmp_path):
    releases = tmp_path / "releases"
    releases.mkdir()
    paths = []
    for n in range(7):
        path = releases / (str(n) * 40)
        path.mkdir()
        (path / ".deployed.json").write_text("{}")
        os.utime(path, (n + 1, n + 1))
        paths.append(path)
    private = tmp_path / "documents"
    private.mkdir()
    (private / "synthetic.txt").write_text("preserve")
    incomplete = releases / ("f" * 40)
    incomplete.mkdir()
    release.prune(releases, paths[0], paths[1], keep=3)
    assert paths[0].exists() and paths[1].exists()
    assert not paths[2].exists() and not paths[3].exists()
    assert incomplete.exists() and (private / "synthetic.txt").read_text() == "preserve"


@pytest.mark.parametrize("failure", ["backup", "restart", "health", "migration"])
def test_failure_preserves_database_and_only_rolls_back_compatible_code(
    tmp_path, monkeypatch, failure
):
    calls = []
    db = tmp_path / "synthetic.db"
    db.write_bytes(b"persistent")
    monkeypatch.setattr(host, "service", lambda action: calls.append(action))

    def fail_at(name):
        calls.append(name)
        if name == failure:
            raise RuntimeError(name)

    def verify(candidate):
        if candidate == "new":
            fail_at("health")
        calls.append("verified-" + candidate)

    def restart():
        if failure == "restart" and "restart" not in calls:
            fail_at("restart")
        calls.append("restart")

    with pytest.raises(RuntimeError):
        host.apply_release(
            "old",
            "new",
            failure == "migration",
            lambda: fail_at("backup"),
            lambda: fail_at("migration"),
            lambda candidate: calls.append("activate-" + candidate),
            restart,
            verify,
        )
    assert db.read_bytes() == b"persistent"
    if failure == "migration":
        assert calls[-1] == "stop" and "activate-old" not in calls
    else:
        assert "verified-old" in calls
    if failure == "backup":
        assert "activate-new" not in calls


def test_success_after_migration_does_not_downgrade_on_health_failure(monkeypatch):
    calls = []
    monkeypatch.setattr(host, "service", lambda action: calls.append(action))
    with pytest.raises(RuntimeError):
        host.apply_release(
            "old",
            "new",
            True,
            lambda: None,
            lambda: None,
            calls.append,
            lambda: None,
            lambda _: (_ for _ in ()).throw(RuntimeError("health")),
        )
    assert calls == ["stop", "new", "stop"]


def test_low_disk_and_stale_deployments_fail_before_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(host.shutil, "disk_usage", lambda _: SimpleNamespace(free=1024))
    with pytest.raises(ValueError, match="2 GiB"):
        host.preflight(tmp_path, 2)
    (tmp_path / "last-success.json").write_text(json.dumps({"sequence": 3}))
    with pytest.raises(ValueError, match="Stale"):
        host.preflight(tmp_path, 2)


def test_production_environment_rejects_shell_expansion(tmp_path):
    path = tmp_path / "config"
    path.write_text("ROLEPILOT_DATA_DIR=$(unsafe)\n")
    with pytest.raises(ValueError, match="literal"):
        host.read_env(path)


@pytest.mark.skipif(os.name != "posix", reason="OpenSSH runner harness uses POSIX executables")
def test_ssh_auth_failure_never_transfers_or_deploys(tmp_path):
    root = Path(__file__).resolve().parents[1]
    binaries = tmp_path / "bin"
    binaries.mkdir()
    for name, body in {
        "ssh": "exit 255",
        "ssh-keygen": "exit 0",
        "scp": f"touch '{tmp_path / 'transferred'}'",
    }.items():
        script = binaries / name
        script.write_text("#!/bin/sh\n" + body + "\n")
        script.chmod(0o755)
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    (artifacts / "release.tar.gz").write_bytes(b"fixture")
    (artifacts / "release.tar.gz.sha256").write_text(hashlib.sha256(b"fixture").hexdigest())
    env = os.environ | {
        "PATH": str(binaries) + os.pathsep + os.environ["PATH"],
        "LIGHTSAIL_HOST": "example.invalid",
        "LIGHTSAIL_USER": "rolepilot-deploy",
        "LIGHTSAIL_SSH_KEY": "synthetic-identity",
        "LIGHTSAIL_SSH_HOST_KEY": "synthetic-host",
        "RELEASE_SHA": "a" * 40,
        "RELEASE_SEQUENCE": "1",
    }
    result = subprocess.run(
        ["bash", str(root / "deploy/scripts/ssh_deploy.sh")],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 255
    assert not (tmp_path / "transferred").exists()
    assert "synthetic-identity" not in result.stdout + result.stderr
