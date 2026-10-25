"""Consistent SQLite backup with optional persistent files and explicit library copy."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from app.db import DATA, DATABASE_URL


def database_path() -> Path:
    prefix = "sqlite:///"
    if not DATABASE_URL.startswith(prefix):
        raise SystemExit("RolePilot backup supports SQLite database URLs only")
    result = Path(DATABASE_URL[len(prefix) :]).expanduser()
    if not result.is_absolute():
        result = (Path.cwd() / result).resolve()
    return result


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def consistent_backup(source: Path, destination: Path) -> None:
    with closing(sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True, timeout=30)) as src:
        with closing(sqlite3.connect(destination)) as dest:
            src.backup(dest, pages=512, sleep=0.05)
            if dest.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("SQLite integrity check failed on backup")
            if dest.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("SQLite foreign-key check failed on backup")


def add_tree(archive: tarfile.TarFile, root: Path, name: str) -> None:
    for path in [root, *root.rglob("*")]:
        if path.is_symlink():
            raise RuntimeError(f"Refusing to back up symbolic link: {path}")
        relative = path.relative_to(root)
        arcname = PurePosixPath(name, *relative.parts).as_posix()
        archive.add(path, arcname=arcname, recursive=False)


def tree_hashes(root: Path, name: str) -> dict[str, str]:
    result = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(f"Refusing to back up symbolic link: {path}")
        if path.is_file():
            relative = PurePosixPath(name, *path.relative_to(root).parts).as_posix()
            result[relative] = sha256(path)
    return result


def create_backup(include_library: bool = False) -> Path:
    source = database_path()
    if not source.is_file():
        raise SystemExit(f"SQLite database not found: {source}")
    backup_root = Path(os.environ.get("ROLEPILOT_BACKUP_DIR", DATA / "backups")).resolve()
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(backup_root, 0o700)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = backup_root / f"rolepilot-{stamp}.tar.gz"
    storage = Path(os.environ.get("ROLEPILOT_DOCUMENT_STORAGE", DATA / "documents"))
    library = Path(os.environ.get("ROLEPILOT_LIBRARY_ROOT", Path.home() / "RolePilot" / "library"))

    with tempfile.TemporaryDirectory(dir=backup_root) as workspace:
        stage = Path(workspace)
        db_copy = stage / "database.sqlite3"
        consistent_backup(source, db_copy)
        files = {"database.sqlite3": sha256(db_copy)}
        if storage.exists():
            files.update(tree_hashes(storage, "documents"))
        if include_library:
            if not library.is_dir():
                raise RuntimeError("Configured document library is unavailable")
            files.update(tree_hashes(library, "document_library"))
        config = {
            "schema_version": "RolePilot backup v1",
            "database_url_kind": "sqlite",
            "document_storage_configured": bool(os.environ.get("ROLEPILOT_DOCUMENT_STORAGE")),
            "full_document_library_included": include_library,
            "secrets_included": False,
        }
        manifest_path = stage / "manifest.json"
        manifest_path.write_text(
            json.dumps(
                {"created_at": datetime.now(UTC).isoformat(), "files": files, "config": config},
                indent=2,
            ),
            encoding="utf-8",
        )
        temp_output = stage / "backup.tar.gz"
        with tarfile.open(temp_output, "w:gz") as archive:
            archive.add(db_copy, arcname="database.sqlite3")
            if storage.exists():
                add_tree(archive, storage, "documents")
            if include_library:
                add_tree(archive, library, "document_library")
            archive.add(manifest_path, arcname="manifest.json")
        shutil.copy2(temp_output, output)
    try:
        os.chmod(output, 0o600)
    except OSError:
        pass
    prune_backups(backup_root)
    return output


def prune_backups(root: Path, keep: int = 30) -> None:
    files = sorted(
        root.glob("rolepilot-*.tar.gz"), key=lambda path: path.stat().st_mtime, reverse=True
    )
    for old in files[keep:]:
        old.unlink()


def safe_extract(archive: tarfile.TarFile, destination: Path) -> None:
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            raise RuntimeError("Backup contains an unsafe path")
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise RuntimeError("Backup contains an unsupported filesystem object")
    archive.extractall(destination, filter="data")


def verify_backup(backup: Path, destination: Path) -> dict:
    with tarfile.open(backup, "r:gz") as archive:
        safe_extract(archive, destination)
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    for relative, digest in manifest["files"].items():
        path = destination / relative
        if not path.is_file() or sha256(path) != digest:
            raise RuntimeError(f"Backup integrity check failed: {relative}")
    db_file = destination / "database.sqlite3"
    with closing(sqlite3.connect(db_file)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Restored database failed SQLite integrity_check")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise RuntimeError("Restored database failed foreign_key_check")
    return manifest


def restore_backup(backup: Path, include_files: bool, include_library: bool) -> Path:
    target = database_path()
    backup_root = Path(os.environ.get("ROLEPILOT_BACKUP_DIR", DATA / "backups")).resolve()
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    with tempfile.TemporaryDirectory(dir=backup_root) as workspace:
        stage = Path(workspace)
        verify_backup(backup.resolve(), stage)
        storage = Path(os.environ.get("ROLEPILOT_DOCUMENT_STORAGE", DATA / "documents"))
        library = Path(
            os.environ.get("ROLEPILOT_LIBRARY_ROOT", Path.home() / "RolePilot" / "library")
        )
        restore_storage = include_files and (stage / "documents").exists()
        restore_library = include_library and (stage / "document_library").exists()
        if restore_storage:
            if storage.exists() and any(storage.iterdir()):
                raise RuntimeError(
                    "Document storage is not empty; restore to an empty configured directory"
                )
        if restore_library:
            if library.exists() and any(library.iterdir()):
                raise RuntimeError(
                    "Document library is not empty; restore to an empty configured directory"
                )
        if target.exists():
            pre_restore = backup_root / f"rolepilot-pre-restore-{stamp}.sqlite3"
            consistent_backup(target, pre_restore)
        with closing(sqlite3.connect(target)) as connection:
            if connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] != 0:
                raise RuntimeError("Could not checkpoint SQLite WAL; ensure the service is stopped")
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(target) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        replacement = target.with_suffix(f".restore-{stamp}.sqlite3")
        shutil.copy2(stage / "database.sqlite3", replacement)
        # A restore may bring back tokens revoked since the backup or recorded
        # on another host. Preserve accounts but require fresh logins.
        with closing(sqlite3.connect(replacement)) as connection:
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if "auth_sessions" in tables:
                connection.execute("DELETE FROM auth_sessions")
                connection.commit()
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Restored database failed SQLite integrity_check")
            if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("Restored database failed foreign_key_check")
        os.replace(replacement, target)
        os.chmod(target, 0o600)
        if restore_storage:
            storage.parent.mkdir(parents=True, exist_ok=True)
            temporary_storage = storage.with_name(f"{storage.name}.restore-{stamp}")
            shutil.copytree(stage / "documents", temporary_storage)
            if storage.exists():
                storage.rmdir()
            os.replace(temporary_storage, storage)
        if restore_library:
            library.parent.mkdir(parents=True, exist_ok=True)
            temporary_library = library.with_name(f"{library.name}.restore-{stamp}")
            shutil.copytree(stage / "document_library", temporary_library)
            if library.exists():
                library.rmdir()
            os.replace(temporary_library, library)
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--backup", action="store_true")
    modes.add_argument("--restore", type=Path)
    modes.add_argument("--verify", type=Path)
    parser.add_argument(
        "--include-library", action="store_true", help="Explicitly include source library files"
    )
    parser.add_argument(
        "--include-files",
        action="store_true",
        help="Restore uploaded/generated files into empty storage",
    )
    parser.add_argument(
        "--restore-library",
        action="store_true",
        help="Explicitly restore a library included in the backup",
    )
    parser.add_argument(
        "--service-stopped", action="store_true", help="Required for restore; stop RolePilot first"
    )
    args = parser.parse_args()
    if args.backup:
        print(create_backup(args.include_library))
    elif args.verify:
        backup_root = Path(os.environ.get("ROLEPILOT_BACKUP_DIR", DATA / "backups")).resolve()
        backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.TemporaryDirectory(dir=backup_root) as workspace:
            manifest = verify_backup(args.verify.resolve(), Path(workspace))
        print(
            f"Verified {len(manifest['files'])} files; SQLite integrity and foreign keys are valid."
        )
    else:
        if not args.service_stopped:
            raise SystemExit("Stop the RolePilot service and pass --service-stopped before restore")
        print(restore_backup(args.restore, args.include_files, args.restore_library))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
