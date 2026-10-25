"""Trusted release archive validation. Standard library only; no application imports."""

import hashlib
import json
import re
import tarfile
from pathlib import Path, PurePosixPath

SHA = re.compile(r"[0-9a-f]{40}")
TOP_FILES = {"alembic.ini", "pyproject.toml", "requirements.lock", "RELEASE.json"}


def allowed(name):
    path = PurePosixPath(name)
    return (
        not path.is_absolute()
        and ".." not in path.parts
        and "\\" not in name
        and ":" not in name
        and all(not p.startswith(".") for p in path.parts)
        and not any(p in {"__pycache__", "node_modules", "data", "documents"} for p in path.parts)
        and (
            name in TOP_FILES
            or name.startswith(("backend/app/", "backend/migrations/", "deploy/", "frontend/dist/"))
        )
        and not name.endswith(
            (
                ".pyc",
                ".db",
                ".sqlite",
                ".sqlite3",
                ".db-wal",
                ".db-shm",
                ".sqlite3-wal",
                ".sqlite3-shm",
                ".pem",
                ".key",
                ".log",
            )
        )
    )


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def unpack(archive, destination, commit, expected_digest):
    if not SHA.fullmatch(commit) or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        raise ValueError("Invalid release identity")
    if digest(archive) != expected_digest:
        raise ValueError("Release archive checksum mismatch")
    destination = Path(destination)
    if destination.exists():
        raise ValueError("Release destination already exists; inspect the previous attempt")
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)) or len(names) > 20000:
            raise ValueError("Duplicate or excessive archive members")
        if sum(m.size for m in members) > 1024**3:
            raise ValueError("Unpacked release exceeds 1 GiB")
        if any(not m.isfile() or not allowed(m.name) for m in members):
            raise ValueError("Unsafe release member (path, link or file type)")
        required = {
            "RELEASE.json",
            "requirements.lock",
            "alembic.ini",
            "backend/app/main.py",
            "frontend/dist/index.html",
        }
        if not required.issubset(names):
            raise ValueError("Incomplete release archive")
        manifest = json.load(bundle.extractfile("RELEASE.json"))
        if manifest.get("commit") != commit:
            raise ValueError("Manifest commit does not match approved commit")
        files = manifest.get("files", {})
        if set(files) != set(names) - {"RELEASE.json"}:
            raise ValueError("Manifest does not describe every file")
        # Validate all bytes before any extraction. No archive links are accepted.
        for member in members:
            if member.name != "RELEASE.json":
                value = hashlib.sha256(bundle.extractfile(member).read()).hexdigest()
                if files[member.name] != value:
                    raise ValueError("Manifest file checksum mismatch")
        destination.mkdir(mode=0o755)
        for member in members:
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.extractfile(member).read())
            target.chmod(0o644)
    return manifest


def prune(releases, current, previous, keep=5):
    """Only complete SHA directories immediately under releases; never follow links."""
    import shutil

    releases = Path(releases).resolve()
    protected = {Path(current).resolve(), Path(previous).resolve()}
    candidates = sorted(
        (
            p
            for p in releases.iterdir()
            if SHA.fullmatch(p.name)
            and not p.is_symlink()
            and p.is_dir()
            and (p / ".deployed.json").is_file()
        ),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for item in candidates[keep:]:
        if item.resolve().parent != releases or item.resolve() in protected:
            continue
        shutil.rmtree(item)
