"""Validation for a reverse-proxied hosted instance."""

import os
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]


def validate_production_environment(environ=None, checkout_root: Path | None = None) -> None:
    values = os.environ if environ is None else environ
    if values.get("ROLEPILOT_AUTH_REQUIRED", "0").casefold() not in {"1", "true", "yes"}:
        raise ValueError("Hosted deployments must set ROLEPILOT_AUTH_REQUIRED=1")
    if values.get("ROLEPILOT_COOKIE_SECURE", "1").casefold() not in {"1", "true", "yes"}:
        raise ValueError("Hosted deployments require Secure session cookies")
    origin = values.get("ROLEPILOT_PUBLIC_ORIGIN", "")
    if not origin:
        raise ValueError("Hosted deployments must set ROLEPILOT_PUBLIC_ORIGIN")
    parsed = urlparse(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.path not in {"", "/"}:
        raise ValueError("ROLEPILOT_PUBLIC_ORIGIN must be an HTTPS origin without a path")
    hosts = {
        item.strip()
        for item in values.get("ROLEPILOT_ALLOWED_HOSTS", "").split(",")
        if item.strip()
    }
    if not hosts:
        raise ValueError("Hosted deployments must set ROLEPILOT_ALLOWED_HOSTS")
    if parsed.hostname not in hosts:
        raise ValueError("ROLEPILOT_ALLOWED_HOSTS must include the public host")
    data_dir = Path(values.get("ROLEPILOT_DATA_DIR", "")).expanduser()
    if not data_dir.is_absolute():
        raise ValueError("ROLEPILOT_DATA_DIR must be an absolute persistent directory")
    resolved = data_dir.resolve()
    try:
        resolved.relative_to((checkout_root or ROOT).resolve())
    except ValueError:
        pass
    else:
        raise ValueError("Hosted SQLite data must be outside the source checkout")
    database_url = values.get("ROLEPILOT_DATABASE_URL", "")
    if database_url:
        prefix = "sqlite:///"
        if not database_url.startswith(prefix):
            raise ValueError("Only SQLite URLs are supported for this deployment")
        database_path = Path(database_url[len(prefix) :]).expanduser()
        if not database_path.is_absolute() or not database_path.resolve().is_relative_to(resolved):
            raise ValueError("ROLEPILOT_DATABASE_URL must be inside ROLEPILOT_DATA_DIR")
    for setting in (
        "ROLEPILOT_LIBRARY_ROOT",
        "ROLEPILOT_DOCUMENT_STORAGE",
        "ROLEPILOT_BACKUP_DIR",
    ):
        configured = Path(values.get(setting, "")).expanduser()
        if not configured.is_absolute():
            raise ValueError(f"{setting} must be an absolute persistent directory")
        try:
            configured.resolve().relative_to((checkout_root or ROOT).resolve())
        except ValueError:
            continue
        raise ValueError(f"Hosted {setting} must be outside the source checkout")
