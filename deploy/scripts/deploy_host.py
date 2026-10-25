"""Root-owned broker installed outside releases. Never execute this from an upload.

Candidate builds run as rolepilot-build; migrations run as rolepilot. Persistent
data is never extracted, cleaned, reinitialized, restored or downgraded here.
"""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

try:
    from .release import SHA, prune, unpack
except ImportError:  # Installed as standalone root-owned modules.
    from release import SHA, prune, unpack

ROOT = Path("/opt/rolepilot")
CONFIG = Path("/etc/rolepilot")
INCOMING = Path("/var/lib/rolepilot-deploy/incoming")
LOGS = Path("/var/log/rolepilot-deploy")


def preflight(root, sequence):
    last = root / "last-success.json"
    if last.exists() and sequence <= json.loads(last.read_text())["sequence"]:
        raise ValueError("Stale or already successful deployment refused")
    if shutil.disk_usage(root).free < 2 * 1024**3:
        raise ValueError("At least 2 GiB free space is required")
    return last


def read_env(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"ROLEPILOT_[A-Z_]+", key) or key in result:
            raise ValueError("Invalid or duplicate configuration key")
        if any(char in value for char in "\n\r\0$`\"'"):
            raise ValueError("Use literal unquoted configuration values")
        result[key] = value
    if result.get("ROLEPILOT_AUTH_REQUIRED") != "1" or result.get("ROLEPILOT_COOKIE_SECURE") != "1":
        raise ValueError("Hosted authentication and Secure cookies are required")
    if result.get("ROLEPILOT_PUBLIC_ORIGIN") != "https://rolepilot.adityamore.dev":
        raise ValueError("Unexpected production origin")
    for key in (
        "ROLEPILOT_DATA_DIR",
        "ROLEPILOT_LIBRARY_ROOT",
        "ROLEPILOT_DOCUMENT_STORAGE",
        "ROLEPILOT_BACKUP_DIR",
    ):
        value = Path(result.get(key, ""))
        if not value.is_absolute() or value.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError(f"{key} must be outside releases")
    return result


def command(args, *, cwd=None, env=None, capture=False):
    return subprocess.run(
        args, cwd=cwd, env=env, check=True, text=True, stdout=subprocess.PIPE if capture else None
    ).stdout


def service(action):
    command(["/usr/bin/systemctl", action, "rolepilot"])


def switch(target):
    link = ROOT / "current.next"
    link.unlink(missing_ok=True)
    link.symlink_to(target)
    link.replace(ROOT / "current")


def http(origin, path):
    try:
        with urllib.request.urlopen(origin + path, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b""  # Never print protected endpoint content.


def health(release, origin):
    last_error = None
    for _ in range(15):
        try:
            status, body = http(origin, "/api/health")
            if status != 200 or json.loads(body).get("status") != "ok":
                raise RuntimeError("API health failed")
            status, body = http(origin, "/api/auth/session")
            session = json.loads(body)
            if (
                status != 200
                or session.get("auth_required") is not True
                or session.get("authenticated")
            ):
                raise RuntimeError("Hosted authentication gate failed")
            if http(origin, "/api/jobs")[0] != 401:
                raise RuntimeError("Protected API must reject anonymous access")
            status, body = http(origin, "/")
            if status != 200 or body != (release / "frontend/dist/index.html").read_bytes():
                raise RuntimeError("Frontend did not serve the activated release")
            return
        except (ValueError, OSError, RuntimeError) as error:
            last_error = error
            time.sleep(2)
    raise RuntimeError("HTTPS frontend/API/authentication health check failed") from last_error


def apply_release(previous, candidate, migrate, prepare_backup, upgrade, activate, restart, verify):
    """Testable failure boundary. Migration attempt makes rollback compatibility unknown."""
    migration_started = False
    stopped = False
    activated = False
    try:
        service("stop")
        stopped = True
        prepare_backup()
        if migrate:
            migration_started = True
            upgrade()
        activate(candidate)
        activated = True
        restart()
        verify(candidate)
    except BaseException:
        if migration_started:
            service("stop")
            print(
                "Migration attempted: database preserved; service stopped. "
                "Manual recovery required."
            )
        elif stopped:
            if activated:
                activate(previous)
            try:
                restart()
                verify(previous)
                print("Previous release restored and checked; database preserved.")
            except Exception:
                service("stop")
                print(
                    "Previous release also failed; service stopped. Inspect protected server logs."
                )
        raise


def deploy(commit, sequence, checksum):
    import fcntl

    if os.geteuid() != 0 or not SHA.fullmatch(commit) or sequence < 1:
        raise ValueError("Use the installed sudo broker with a SHA and positive run number")
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("Invalid archive digest")
    if (CONFIG / "deployment-enabled").read_text().strip() != "enabled":
        raise ValueError("Server deployment gate is disabled")
    with (ROOT / "deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Descriptor is not inherited by children; exit/signals release it.
        last = preflight(ROOT, sequence)
        current = ROOT / "current"
        previous = current.resolve(strict=True)
        releases = ROOT / "releases"
        if (
            not current.is_symlink()
            or previous.parent != releases
            or not SHA.fullmatch(previous.name)
        ):
            raise ValueError("Bootstrap the current/SHA release layout before enabling CD")
        command(["/usr/bin/systemctl", "is-active", "--quiet", "rolepilot"])
        env = read_env(CONFIG / "rolepilot.env")
        origin = env["ROLEPILOT_PUBLIC_ORIGIN"]
        health(previous, origin)
        archive = INCOMING / f"{commit}-{sequence}.tar.gz"
        if archive.is_symlink() or archive.stat().st_size > 256 * 1024**2:
            raise ValueError("Invalid or oversized incoming archive")
        # Root-owned copy prevents SSH user swapping bytes after verification.
        secured = ROOT / f"incoming-{commit}-{sequence}.tar.gz"
        with archive.open("rb") as source, secured.open("xb") as target:
            shutil.copyfileobj(source, target)
        secured.chmod(0o600)
        candidate = releases / commit
        try:
            unpack(secured, candidate, commit, checksum)
        finally:
            secured.unlink(missing_ok=True)
        command(["/usr/bin/chown", "-R", "rolepilot-build:rolepilot-build", str(candidate)])
        build_env = {
            "PATH": "/usr/bin:/bin",
            "HOME": "/var/lib/rolepilot-build",
            "PYTHONDONTWRITEBYTECODE": "1",
        }

        def build(*args):
            return command(
                ["/usr/sbin/runuser", "-u", "rolepilot-build", "--", *args],
                cwd=candidate,
                env=build_env,
            )

        python = candidate / ".venv/bin/python"
        try:
            build("/usr/bin/python3.13", "-m", "venv", str(candidate / ".venv"))
            build(
                str(python),
                "-m",
                "pip",
                "install",
                "--only-binary=:all:",
                "-r",
                "requirements.lock",
            )
        finally:
            command(["/usr/bin/chown", "-R", "root:root", str(candidate)])
            command(["/usr/bin/chmod", "-R", "u=rwX,go=rX", str(candidate)])

        def app(release, *args, capture=False):
            runtime = env | {
                "PATH": "/usr/bin:/bin",
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONPATH": str(release / "backend"),
            }
            return command(
                [
                    "/usr/sbin/runuser",
                    "-u",
                    "rolepilot",
                    "--",
                    str(release / ".venv/bin/python"),
                    *args,
                ],
                cwd=release,
                env=runtime,
                capture=capture,
            )

        app(
            candidate,
            "-c",
            "from app.production_config import validate_production_environment; "
            "validate_production_environment()",
        )
        state = json.loads(app(candidate, "deploy/scripts/schema_state.py", capture=True))
        migrate = state["current"] != state["head"]
        approved = CONFIG / "approved-migrations"
        if migrate and (
            not approved.exists() or state["head"] not in approved.read_text().splitlines()
        ):
            raise ValueError("Pending migration head needs explicit server-side approval")

        def backup():
            path = app(previous, "deploy/scripts/backup.py", "--backup", capture=True).strip()
            app(previous, "deploy/scripts/backup.py", "--verify", path)

        apply_release(
            previous,
            candidate,
            migrate,
            backup,
            lambda: app(candidate, "-m", "alembic", "upgrade", "head"),
            switch,
            lambda: service("restart"),
            lambda release: health(release, origin),
        )
        record = {
            "commit": commit,
            "sequence": sequence,
            "archive_sha256": checksum,
            "schema": state["head"],
            "previous": previous.name,
            "completed_at": datetime.now(UTC).isoformat(),
        }
        (candidate / ".deployed.json").write_text(json.dumps(record))
        temporary = ROOT / "last-success.next"
        temporary.write_text(json.dumps(record))
        temporary.replace(last)
        archive.unlink()
        prune(releases, candidate, previous)
        print(f"Deployed {commit}; run {sequence}; schema {state['head']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("commit")
    parser.add_argument("sequence", type=int)
    parser.add_argument("checksum")
    args = parser.parse_args()
    if not SHA.fullmatch(args.commit) or args.sequence < 1:
        raise SystemExit("Invalid release identity")
    LOGS.mkdir(mode=0o700, exist_ok=True)
    log = LOGS / f"{args.commit}-{args.sequence}-{time.time_ns()}.log"
    # Full diagnostics stay in protected server logs, never in Actions output.
    with log.open("x") as output:
        log.chmod(0o600)
        os.dup2(output.fileno(), 1)
        os.dup2(output.fileno(), 2)

        def interrupted(signum, frame):
            raise RuntimeError(f"Deployment interrupted by signal {signum}")

        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, interrupted)
        deploy(args.commit, args.sequence, args.checksum)


if __name__ == "__main__":
    main()
