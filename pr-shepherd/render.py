"""Render the Orka Task manifests for the dynamo PR shepherd.

Usage: uv run --with pyyaml python render.py
Writes pr-shepherd.yaml (the schedule) and pr-shepherd-dryrun.yaml.

The schedule fires every 15 minutes. Each slot starts with the PR watch gate (watch.mjs),
which runs the full shepherd at the regular times (every 2 hours, every day),
runs it scoped to new merge conflicts and CI failures in between, and otherwise exits.
With reviews on (REVIEW_MODE below), the gate also starts a review run (the skill's steps
C, R and S) for a PR head that has new commits from someone other than the shepherd and
has been quiet for an hour.

The shepherd instructions come from the same pr-shepherd skill that the local Copilot
app automation uses (~/.copilot/skills/pr-shepherd/SKILL.md; override with
PR_SHEPHERD_SKILL). Re-run this after editing the skill, then re-apply. prompt.md is
the original Nov 4 automation prompt, kept for reference only.
"""

import base64
import hashlib
import os
from pathlib import Path

import yaml

HERE = Path(__file__).parent
SKILL = Path(os.environ.get("PR_SHEPHERD_SKILL", "~/.copilot/skills/pr-shepherd/SKILL.md")).expanduser()
IMAGE = "docker.io/library/node:22-bookworm@sha256:18a6d90fd60542269850c80ca03b29b1d9b14d6b221ac7ee8e35b0d33ef904bd"
NAMESPACE = "orka-system"
# The skill's review mode (steps C, R and S): "off", "shadow" (review, but put the brief and
# the fixes it would push in the report) or "live" (push verified fixes, post the brief,
# resolve declined CodeRabbit threads). Dry runs use it too, but never write to GitHub.
REVIEW_MODE = "shadow"


class Literal(str):
    pass


def ssh_fingerprint(public_key_line):
    """SHA256 fingerprint of an OpenSSH public key, as ssh-keygen -l and GitHub print it."""
    blob = base64.b64decode(public_key_line.split()[1])
    return base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


# Commits signed with this key are the shepherd's, so they never start a review.
SIGNING_FINGERPRINT = ssh_fingerprint((HERE / "signing_key.pub").read_text())


yaml.SafeDumper.add_representer(
    Literal, lambda d, v: d.represent_scalar("tag:yaml.org,2002:str", v, style="|")
)


def task(name, prompt, timeout, extra_spec=None, labels=None, extra_env=None):
    spec = {
        "type": "container",
        "image": IMAGE,
        "command": ["bash", "-c"],
        "args": [Literal((HERE / "bootstrap.sh").read_text())],
        "env": [
            {"name": "TZ", "value": "America/New_York"},
            {"name": "SHEPHERD_MODEL", "value": "claude-opus-5.5"},
            {"name": "SHEPHERD_EFFORT", "value": "xhigh"},
            {
                "name": "GH_TOKEN",
                "valueFrom": {"secretKeyRef": {"name": "pr-shepherd-github", "key": "token"}},
            },
            {
                "name": "SSH_SIGNING_KEY",
                "valueFrom": {"secretKeyRef": {"name": "pr-shepherd-signing", "key": "signing_key"}},
            },
            {"name": "SHEPHERD_PROMPT", "value": Literal(prompt)},
            {"name": "SHEPHERD_REVIEW", "value": REVIEW_MODE},
            {"name": "SHEPHERD_SIGNING_FINGERPRINT", "value": SIGNING_FINGERPRINT},
            *(extra_env or []),
            {"name": "SHEPHERD_WATCH_JS", "value": Literal((HERE / "watch.mjs").read_text())},
        ],
        "resources": {
            "requests": {"cpu": "500m", "memory": "1Gi"},
            "limits": {"cpu": "3", "memory": "6Gi"},
        },
        "execution": {"nodeSelector": {"agentpool": "nodepool1"}},
        "timeout": timeout,
        # A retry would repeat pushes, replies, and pings, so never retry.
        "retryPolicy": {"maxRetries": 0},
    }
    spec.update(extra_spec or {})
    return {
        "apiVersion": "core.orka.ai/v1alpha1",
        "kind": "Task",
        "metadata": {
            "name": name,
            "namespace": NAMESPACE,
            "labels": {"app.kubernetes.io/name": "pr-shepherd", **(labels or {})},
        },
        "spec": spec,
    }


def write(path, obj):
    path.write_text(yaml.safe_dump(obj, sort_keys=False, width=1000))
    print(f"wrote {path.name}")


def skill_body(path):
    """Return the skill's instructions without its YAML frontmatter."""
    text = path.read_text()
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end == -1:
            raise SystemExit(f"{path}: unterminated frontmatter")
        text = text[end + len("\n---\n"):]
    return text.lstrip("\n")


if REVIEW_MODE not in ("off", "shadow", "live"):
    raise SystemExit(f"REVIEW_MODE must be off, shadow or live, not {REVIEW_MODE!r}")
preamble = (HERE / "preamble.md").read_text().rstrip("\n") + (
    f"\n- Review mode: `{REVIEW_MODE}`, which overrides the skill's default. The skill's Review mode section says what it means for steps C, R and S.\n\n"
)
prompt = skill_body(SKILL)

write(
    HERE / "pr-shepherd.yaml",
    task(
        "dynamo-pr-shepherd",
        preamble + prompt,
        "105m",
        extra_spec={
            # Every 15 minutes; watch.mjs decides what each slot does. The regular-run
            # times live in watch.mjs (SHEPHERD_FULL_DAYS and SHEPHERD_FULL_HOURS).
            "schedule": "*/15 * * * *",
            "timeZone": "America/New_York",
            # Forbid keeps regular and triggered runs from overlapping.
            "concurrencyPolicy": "Forbid",
            "startingDeadlineSeconds": 600,
            # Most slots end without running the shepherd, so keep about a day of runs.
            "successfulRunsHistoryLimit": 100,
            "failedRunsHistoryLimit": 10,
            # No "suspend" here: pause and resume with kubectl patch (see README), so
            # re-applying a render never turns the schedule on or off.
        },
        extra_env=[{"name": "SHEPHERD_MODE", "value": "auto"}],
    ),
)
write(
    HERE / "pr-shepherd-dryrun.yaml",
    task(
        "dynamo-pr-shepherd-dryrun",
        (HERE / "dryrun-preamble.md").read_text() + preamble + prompt,
        "90m",
        labels={"pr-shepherd/mode": "dry-run"},
        # A full run that never records anything in the watch state.
        extra_env=[
            {"name": "SHEPHERD_MODE", "value": "full"},
            {"name": "SHEPHERD_READ_ONLY", "value": "1"},
        ],
    ),
)
