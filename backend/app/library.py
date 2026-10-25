"""Read-only library scanning. Only SQLite metadata is written."""

import hashlib
import os
import re
import stat
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from sqlalchemy import select

from .db import utcnow
from .library_models import Document, DocumentLibrary, DocumentRevision

DEFAULT_LIBRARY_ROOT = str(Path.home() / "RolePilot" / "library")
SCAN_DIRS = ("Resumes", "cover_letters")
SUPPORTED = {".pdf", ".docx", ".doc", ".txt", ".md", ".markdown", ".tex"}
EXCLUDED = {".claude", "src", ".git", "node_modules"}
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_FILES = 20000


def timestamp(value):
    return datetime.fromtimestamp(value, UTC).isoformat()


def reject_links(path):
    # Windows junctions and all other reparse points are rejected as well as symlinks.
    for part in (*reversed(path.parents), path):
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise ValueError("Symbolic links and junctions are not allowed")


def validate_root(raw):
    path = Path(raw)
    if not path.is_absolute() or str(raw).startswith(("\\\\", "//")):
        raise ValueError("Choose an absolute local directory path")
    reject_links(path)
    if not path.is_dir():
        raise ValueError("The library root must be an existing directory")
    # Opening a directory verifies read access without creating anything.
    with os.scandir(path) as entries:
        next(entries, None)
    return path.resolve(strict=True)


def safe_path(root, relative):
    if "\\" in relative or ":" in relative or "\x00" in relative:
        raise ValueError("Invalid relative document path")
    parts = PurePosixPath(relative)
    if parts.is_absolute() or not parts.parts or any(p in {".", ".."} for p in relative.split("/")):
        raise ValueError("Directory traversal is not allowed")
    if parts.parts[0] not in SCAN_DIRS:
        raise ValueError("Document is outside the configured scan directories")
    if any(p.casefold() in EXCLUDED or p.startswith(".") for p in parts.parts[1:]):
        raise ValueError("Excluded resource directory")
    candidate = root.joinpath(*parts.parts)
    reject_links(candidate)
    if not candidate.resolve(strict=True).is_relative_to(root):
        raise ValueError("Document escapes its library")
    return candidate


def file_metadata(root, relative):
    path = safe_path(root, relative)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("Not a regular document file")
    if before.st_size > MAX_FILE_BYTES:
        raise ValueError("File exceeds the 64 MB indexing limit")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("File changed while opening; refresh again")
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    # Check the path again after reading so replacements are not recorded as a verified file.
    reject_links(path)
    current = path.stat()

    def signature(s):
        return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)

    if signature(before) != signature(after) or signature(after) != signature(current):
        raise ValueError("File changed during indexing; refresh again")
    created = getattr(before, "st_birthtime", None)
    return {
        "file_hash": digest.hexdigest(),
        "file_size": before.st_size,
        "modified_at": timestamp(before.st_mtime),
        "file_created_at": timestamp(created) if created is not None else None,
    }


def inferred(relative):
    path = PurePosixPath(relative)
    version = next(
        (
            p
            for p in path.parts
            if re.fullmatch(r"resume_\d{1,2}[A-Za-z]{3}_v\d+(?:_[\w-]+)?", p, re.IGNORECASE)
        ),
        None,
    )
    if path.parts[0] == "cover_letters":
        kind = (
            "Cover Letter"
            if path.suffix.lower() in {".pdf", ".docx", ".doc"}
            else "Supporting Document"
        )
    else:
        kind = (
            "Resume" if path.suffix.lower() in {".pdf", ".docx", ".doc"} else "Supporting Document"
        )
    return {
        "document_type": kind,
        "version_label": version,
        # Preserve folder spelling; do not infer company or role facts from it.
        "folder_hint": path.parts[1] if len(path.parts) > 2 else None,
    }


def ensure_library(session):
    owner_id = session.info.get("owner_id")
    if owner_id is None:
        library = session.get(DocumentLibrary, 1)
        library_id = 1
        root = os.environ.get("ROLEPILOT_LIBRARY_ROOT", DEFAULT_LIBRARY_ROOT)
        root_path = Path(root)
        root_path.mkdir(parents=True, exist_ok=True, mode=0o700)
        for folder in SCAN_DIRS:
            (root_path / folder).mkdir(exist_ok=True, mode=0o700)
    else:
        library = session.scalar(
            select(DocumentLibrary).where(DocumentLibrary.owner_id == owner_id)
        )
        library_id = None
        base = Path(os.environ.get("ROLEPILOT_LIBRARY_ROOT", DEFAULT_LIBRARY_ROOT))
        root_path = base / f"user-{owner_id}"
        root_path.mkdir(parents=True, exist_ok=True, mode=0o700)
        for folder in SCAN_DIRS:
            (root_path / folder).mkdir(exist_ok=True, mode=0o700)
        root = str(root_path)
    if not library:
        values = {"root_path": root}
        if library_id is not None:
            values["id"] = library_id
        library = DocumentLibrary(**values)
        session.add(library)
        session.flush()
    return library


def discover(root):
    found, issues, folders = {}, [], []
    ignored = 0
    visited = 0

    def walk(directory):
        nonlocal ignored, visited
        folders.append(directory.relative_to(root).as_posix())
        with os.scandir(directory) as entries:
            for entry in sorted(entries, key=lambda e: e.name.casefold()):
                visited += 1
                if visited > MAX_FILES:
                    raise ValueError("Library exceeds the 20,000-entry scan limit")
                relative = Path(entry.path).relative_to(root).as_posix()
                try:
                    reject_links(Path(entry.path))
                    if entry.name.casefold() in EXCLUDED or entry.name.startswith("."):
                        ignored += 1
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        walk(Path(entry.path))
                    elif Path(entry.name).suffix.lower() in SUPPORTED:
                        found[relative] = file_metadata(root, relative)
                    else:
                        ignored += 1
                except (OSError, ValueError) as exc:
                    issues.append({"path": relative, "message": str(exc)})

    for name in SCAN_DIRS:
        directory = root / name
        try:
            if not directory.exists():
                issues.append({"path": name, "message": "Scan directory is missing"})
                continue
            reject_links(directory)
            walk(directory)
        except (OSError, ValueError) as exc:
            issues.append({"path": name, "message": str(exc)})
    return found, issues, folders, ignored


def root_report(session, raw):
    root = validate_root(raw)
    # Require at least one expected directory when selecting a new root.
    if not any((root / name).is_dir() for name in SCAN_DIRS):
        raise ValueError("Choose the parent containing Resumes and/or cover_letters")
    library = ensure_library(session)
    documents = list(session.scalars(select(Document).where(Document.library_id == library.id)))
    counts = {"matched": 0, "changed": 0, "missing": 0, "unreadable": 0}
    issues = []
    for document in documents:
        try:
            metadata = file_metadata(root, document.relative_path)
            key = "matched" if metadata["file_hash"] == document.file_hash else "changed"
            counts[key] += 1
            if key == "changed":
                issues.append({"path": document.relative_path, "message": "Checksum differs"})
        except FileNotFoundError:
            counts["missing"] += 1
            issues.append({"path": document.relative_path, "message": "Missing at new root"})
        except (OSError, ValueError) as exc:
            counts["unreadable"] += 1
            issues.append({"path": document.relative_path, "message": str(exc)})
    return {
        "root_path": str(root),
        **counts,
        "issues": issues,
        "requires_approval": bool(counts["changed"] + counts["missing"] + counts["unreadable"]),
    }


def scan_library(session, library):
    scanned_at = utcnow()
    try:
        root = validate_root(library.root_path)
        found, issues, folders, ignored = discover(root)
    except (OSError, ValueError) as exc:
        # An unavailable root says nothing about individual files. Preserve their state.
        library.last_error = str(exc)
        session.flush()
        return {"ok": False, "error": str(exc), "preserved_existing_records": True}
    existing = list(session.scalars(select(Document).where(Document.library_id == library.id)))
    by_path = {d.path_key: d for d in existing}
    counts = {"new": 0, "modified": 0, "unchanged": 0, "missing": 0, "restored": 0}
    observed = set()
    for relative, metadata in found.items():
        key = relative.casefold()
        if key in observed:
            issues.append(
                {"path": relative, "message": "Case-insensitive path collision; not indexed"}
            )
            continue
        observed.add(key)
        document = by_path.get(key)
        if not document:
            document = Document(
                library_id=library.id,
                relative_path=relative,
                path_key=key,
                filename=PurePosixPath(relative).name,
                parent_folder=PurePosixPath(relative).parent.as_posix(),
                format=PurePosixPath(relative).suffix.lower().lstrip("."),
                **inferred(relative),
                **metadata,
                last_verified_at=scanned_at,
            )
            session.add(document)
            session.flush()
            counts["new"] += 1
            changed = True
            note = "Initial read-only observation; no binary snapshot"
        else:
            changed = document.file_hash != metadata["file_hash"]
            if document.is_missing:
                counts["restored"] += 1
            counts["modified" if changed else "unchanged"] += 1
            if changed or document.is_missing or document.relative_path != relative:
                document.revision += 1
            for field, value in metadata.items():
                setattr(document, field, value)
            document.relative_path = relative
            document.filename = PurePosixPath(relative).name
            document.parent_folder = PurePosixPath(relative).parent.as_posix()
            document.last_verified_at = scanned_at
            document.is_missing = False
            document.verification_error = None
            note = "External content change observed; old bytes are not retained"
        if changed:
            session.add(
                DocumentRevision(
                    document_id=document.id,
                    revision_label=document.version_label,
                    source_path=relative,
                    content_hash=metadata["file_hash"],
                    notes=note,
                )
            )
    blocked = [i["path"].casefold() for i in issues]
    for document in existing:
        if document.path_key in observed:
            continue
        if any(document.path_key == p or document.path_key.startswith(p + "/") for p in blocked):
            document.verification_error = "Not verified: scan path was unavailable or unsafe"
            continue
        if not document.is_missing:
            document.revision += 1
        document.is_missing = True
        document.verification_error = None
        counts["missing"] += 1
    # Equal content is evidence to review, never identity. No automatic rename/merge.
    missing = [d for d in existing if d.is_missing]
    candidates = [
        {
            "document_id": d.id,
            "old_path": d.relative_path,
            "candidate_paths": [p for p, meta in found.items() if meta["file_hash"] == d.file_hash],
        }
        for d in missing
    ]
    library.last_scan_at = scanned_at
    library.last_error = "Some paths could not be verified" if issues else None
    library.scan_summary = {
        "ok": True,
        **counts,
        "ignored": ignored,
        "issues": issues,
        "folders": folders,
        "move_candidates": [c for c in candidates if c["candidate_paths"]],
    }
    session.flush()
    return library.scan_summary
