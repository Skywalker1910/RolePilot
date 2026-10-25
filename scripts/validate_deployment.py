"""Validate workflow trust boundaries, templates and required release helpers."""

import json
import re
from pathlib import Path, PurePosixPath

import yaml

ROOT = Path(__file__).resolve().parents[1]
CHECKS = ["Backend Tests", "Frontend Tests", "Integration Tests", "Deployment Validation"]


def validate(root=ROOT):
    # BaseLoader preserves GitHub's `on` key instead of YAML 1.1's boolean coercion.
    workflow = yaml.load((root / ".github/workflows/ci.yml").read_text(), Loader=yaml.BaseLoader)
    assert set(workflow["on"]) == {"push", "pull_request", "workflow_dispatch"}
    assert workflow["on"]["push"]["branches"] == ["main"]
    assert workflow["on"]["pull_request"]["branches"] == ["main"]
    assert workflow["permissions"] == {"contents": "read"}
    jobs = workflow["jobs"]
    required = {"backend", "frontend", "integration", "deployment-validation"}
    assert {jobs[j]["name"] for j in required} == set(CHECKS)
    deploy = jobs["deploy"]
    assert set(deploy["needs"]) == required
    condition = deploy["if"]
    for guard in (
        "github.repository == 'Skywalker1910/RolePilot'",
        "github.ref == 'refs/heads/main'",
        "github.event_name == 'push'",
        "vars.DEPLOYMENT_ENABLED == 'true'",
    ):
        assert guard in condition
    assert "always()" not in condition
    assert deploy["environment"]["name"] == "production"
    assert deploy["concurrency"] == {"group": "rolepilot-production", "cancel-in-progress": "false"}
    for name, job in jobs.items():
        for step in job["steps"]:
            if "uses" in step:
                assert re.fullmatch(r"actions/[a-z-]+@[0-9a-f]{40}", step["uses"])
            if name != "deploy":
                assert "secrets." not in json.dumps(step)
            assert "pull_request.title" not in step.get("run", "")
    protection = json.loads((root / ".github/branch-protection.json").read_text())
    assert [c["context"] for c in protection["required_status_checks"]["checks"]] == CHECKS
    assert protection["required_status_checks"]["strict"] is True
    assert protection["enforce_admins"] is True
    assert protection["required_pull_request_reviews"]["required_approving_review_count"] == 0
    assert protection["allow_force_pushes"] is False
    assert protection["allow_deletions"] is False
    for name in (
        "deploy.sh",
        "install.sh",
        "backup.sh",
        "restore.sh",
        "healthcheck.sh",
        "ssh_deploy.sh",
        "rolepilot-deploy",
        "deploy_host.py",
        "release.py",
        "schema_state.py",
    ):
        assert (root / "deploy/scripts" / name).is_file(), name
    template = dict(
        line.split("=", 1)
        for line in (root / "deploy/rolepilot.env.example").read_text().splitlines()
        if line and not line.startswith("#")
    )
    assert template["ROLEPILOT_AUTH_REQUIRED"] == template["ROLEPILOT_COOKIE_SECURE"] == "1"
    assert template["ROLEPILOT_PUBLIC_ORIGIN"] == "https://career.adityamore.dev"
    for key in (
        "ROLEPILOT_DATA_DIR",
        "ROLEPILOT_LIBRARY_ROOT",
        "ROLEPILOT_DOCUMENT_STORAGE",
        "ROLEPILOT_BACKUP_DIR",
    ):
        assert PurePosixPath(template[key]).is_relative_to("/var")
    ssh = (root / "deploy/scripts/ssh_deploy.sh").read_text()
    assert "StrictHostKeyChecking=yes" in ssh and "StrictHostKeyChecking=no" not in ssh
    service = (root / "deploy/systemd/rolepilot.service").read_text()
    assert "User=rolepilot\n" in service
    assert "/opt/rolepilot/current/.venv/bin/uvicorn" in service
    print("Workflow gates, immutable action pins, templates and deployment helpers validated.")


if __name__ == "__main__":
    validate()
