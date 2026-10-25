"""Package only committed runtime source and this run's built static assets."""

import argparse
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from deploy.scripts.release import SHA, allowed, unpack  # noqa: E402


def build(commit, output):
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    if not SHA.fullmatch(commit) or commit != actual:
        raise ValueError("Only the checked-out commit may be packaged")
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    contents = {}
    for name in filter(None, tracked):
        if allowed(name) and not name.startswith("frontend/dist/") and name != "RELEASE.json":
            contents[name] = subprocess.check_output(["git", "show", f"{commit}:{name}"], cwd=ROOT)
    for path in (ROOT / "frontend/dist").rglob("*"):
        if path.is_symlink():
            raise ValueError("Static asset symlinks are forbidden")
        if path.is_file():
            name = path.relative_to(ROOT).as_posix()
            if not allowed(name):
                raise ValueError(f"Unexpected static asset: {name}")
            contents[name] = path.read_bytes()
    if "frontend/dist/index.html" not in contents:
        raise ValueError("Build the frontend first")
    contents["RELEASE.json"] = json.dumps(
        {
            "commit": commit,
            "files": {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()},
        },
        sort_keys=True,
    ).encode()
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz") as archive:
        for name, data in sorted(contents.items()):
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o644
            archive.addfile(entry, io.BytesIO(data))
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="rolepilot-release-check-") as temporary:
        unpack(output, Path(temporary) / "release", commit, checksum)
    output.with_suffix(output.suffix + ".sha256").write_text(checksum + "\n")
    print(f"Packaged commit {commit}: {len(contents)} files, SHA-256 {checksum}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commit")
    parser.add_argument("output")
    args = parser.parse_args()
    build(args.commit, args.output)
