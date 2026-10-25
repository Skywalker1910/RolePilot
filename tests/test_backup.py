import sqlite3
from contextlib import closing
from pathlib import Path

from deploy.scripts import backup


def setup_db(path: Path, value: str):
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS sample(value TEXT NOT NULL)")
        connection.execute("DELETE FROM sample")
        connection.execute("INSERT INTO sample(value) VALUES (?)", (value,))
        connection.commit()


def test_consistent_backup_preserves_wal_data_and_restores_integrity(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database = data_dir / "rolepilot.db"
    monkeypatch.setattr(backup, "DATA", data_dir)
    monkeypatch.setattr(backup, "DATABASE_URL", f"sqlite:///{database.as_posix()}")
    monkeypatch.setenv("ROLEPILOT_BACKUP_DIR", str(data_dir / "backups"))
    setup_db(database, "before")

    saved = backup.create_backup()
    setup_db(database, "after")
    restored = backup.restore_backup(saved, include_files=False, include_library=False)

    assert restored == database
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute("SELECT value FROM sample").fetchone()[0] == "before"
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert list((data_dir / "backups").glob("rolepilot-pre-restore-*.sqlite3"))


def test_backup_detects_tampered_database_snapshot(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database = data_dir / "rolepilot.db"
    monkeypatch.setattr(backup, "DATA", data_dir)
    monkeypatch.setattr(backup, "DATABASE_URL", f"sqlite:///{database.as_posix()}")
    monkeypatch.setenv("ROLEPILOT_BACKUP_DIR", str(data_dir / "backups"))
    setup_db(database, "safe")
    saved = backup.create_backup()

    import tarfile

    stage = tmp_path / "extract"
    stage.mkdir()
    with tarfile.open(saved, "r:gz") as archive:
        backup.safe_extract(archive, stage)
    with (stage / "database.sqlite3").open("ab") as stream:
        stream.write(b"tampered")
    import json

    (stage / "manifest.json").write_text(
        json.dumps({"files": {"database.sqlite3": "not-the-checksum"}}), encoding="utf-8"
    )
    rebuilt = data_dir / "tampered.tar.gz"
    with tarfile.open(rebuilt, "w:gz") as archive:
        archive.add(stage / "database.sqlite3", arcname="database.sqlite3")
        archive.add(stage / "manifest.json", arcname="manifest.json")
    verify_dir = tmp_path / "verify"
    verify_dir.mkdir()
    try:
        backup.verify_backup(rebuilt, verify_dir)
    except RuntimeError as error:
        assert "integrity check failed" in str(error)
    else:
        raise AssertionError("tampered backup was accepted")


def test_restore_invalidates_hosted_sessions_but_preserves_accounts(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database = data_dir / "rolepilot.db"
    monkeypatch.setattr(backup, "DATA", data_dir)
    monkeypatch.setattr(backup, "DATABASE_URL", f"sqlite:///{database.as_posix()}")
    monkeypatch.setenv("ROLEPILOT_BACKUP_DIR", str(data_dir / "backups"))
    with closing(sqlite3.connect(database)) as connection:
        connection.executescript(
            "CREATE TABLE auth_users(id INTEGER PRIMARY KEY, username TEXT);"
            "CREATE TABLE auth_sessions("
            "id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES auth_users(id));"
            "INSERT INTO auth_users VALUES (1, 'pilot');"
            "INSERT INTO auth_sessions VALUES (1, 1);"
        )
        connection.commit()
    saved = backup.create_backup()
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("DELETE FROM auth_sessions")
        connection.commit()

    backup.restore_backup(saved, include_files=False, include_library=False)
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute("SELECT COUNT(*) FROM auth_users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0
