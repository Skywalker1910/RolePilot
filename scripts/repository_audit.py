"""Audit publication candidates without printing matching secret values.

Before staging, audit git's unignored working files. Before committing, --staged
reads index blobs (not potentially different working files). This complements
manual review; it cannot prove arbitrary personal prose is safe to publish.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOTS = {
    "data",
    "documents",
    "snapshots",
    "submission_snapshots",
    "uploads",
    "library",
    "resume",
    "resumes",
    "cover_letters",
    "imports",
    "exports",
    "backups",
    "tmp",
    "artifacts",
    "private",
    ".aws",
    ".ssh",
    ".codex",
    ".agents",
}
GENERATED = {"node_modules", ".venv", "venv", "__pycache__", "dist", "build"}
FORBIDDEN_SUFFIXES = {
    ".db",
    ".sqlite",
    ".sqlite3",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".crt",
    ".cer",
    ".docx",
    ".pdf",
    ".xlsx",
    ".csv",
    ".log",
    ".bak",
    ".zip",
    ".tgz",
}
PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})"),
    "AWS access key": re.compile(rb"(?:AKIA|ASIA)[A-Z0-9]{16}"),
    "credential URL": re.compile(rb"https?://[^\s/:]+:[^\s/@]+@"),
    "Slack token": re.compile(rb"xox[baprs]-[0-9A-Za-z-]{20,}"),
}
REVIEWED_FIXTURES = {
    "frontend/src/workflow.test.tsx": b"https://" + b"user:pass@example.com",
    "tests/test_imports.py": b"https://" + b"user:secret@example.com/jobs",
}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def unsafe_path(name):
    path = Path(name)
    parts = [part.lower() for part in path.parts]
    return (
        parts[0] in PRIVATE_ROOTS
        or bool(set(parts) & GENERATED)
        or path.suffix.lower() in FORBIDDEN_SUFFIXES
        or bool(re.search(r"\.(?:db|sqlite3?)(?:-|\.)", name, re.I))
        or name.startswith("docs/screenshots/")
        or (path.name.startswith(".env") and not path.name.endswith(".example"))
        or name.endswith(".tar.gz")
    )


def audit(staged=False):
    names = (
        git(
            "ls-files",
            "-z",
            *(["--cached"] if staged else ["--cached", "--others", "--exclude-standard"]),
        )
        .decode()
        .split("\0")
    )
    findings = []
    scanned = 0
    for name in sorted(set(filter(None, names))):
        if unsafe_path(name):
            findings.append({"path": name, "reason": "private/generated file type or path"})
            continue
        path = ROOT / name
        if path.is_symlink():
            findings.append({"path": name, "reason": "symbolic link needs manual review"})
            continue
        content = git("show", f":{name}") if staged else path.read_bytes()
        scanned += 1
        if b"\0" in content:
            findings.append({"path": name, "reason": "unreviewed binary"})
        for label, pattern in PATTERNS.items():
            candidate = content
            if label == "credential URL" and name in REVIEWED_FIXTURES:
                candidate = candidate.replace(REVIEWED_FIXTURES[name], b"REVIEWED_INVALID_URL")
            if pattern.search(candidate):
                findings.append({"path": name, "reason": label})
    return {"scanned": scanned, "findings": findings, "mode": "index" if staged else "working"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true")
    result = audit(parser.parse_args().staged)
    print(json.dumps(result, indent=2))
    raise SystemExit(bool(result["findings"]))
