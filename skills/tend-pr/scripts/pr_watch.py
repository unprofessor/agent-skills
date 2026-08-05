#!/usr/bin/env python3
"""PR watcher for the tend-pr skill.

Polls a GitHub PR's state + comments + CI status. Prints PR_STATE plus any NEW
comments (deduped via a state file) to stdout, and always prints CI status
(pass/fail/pending/unknown + failed job names) so the cron agent can act when
CI is red. Self-cleanup signal: PR_STATE=closed or PR_STATE=merged.

CI is read via the REST Actions API (`/actions/runs?head_sha=...`) rather than
check-runs/GraphQL, because a fork-scoped or fine-grained token may NOT have
`checks:read`, while actions read is commonly available. If the job list can't
be read, CI=unknown is reported (never silently assumed green).

Usage: set REPO/PR (and optionally STATE_FILE) below, then run directly
(python3 pr_watch.py) or from a cronjob. Re-runs are safe / idempotent.
"""
import json
import os
import subprocess

REPO = "owner/repo"          # <-- set me
PR = "12345"                 # <-- set me
STATE_FILE = f"/workspace/pr-watch-{PR}.state"

# Conclusions that mean CI is NOT green (anything else apart from 'success'
# that indicates a bad state). 'neutral'/'skipped'/'stale' do not fail a PR.
NON_GREEN = {"failure", "cancelled", "timed_out", "action_required", "start_failure"}


def gh(*args):
    r = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return r.stdout


def ci_check(sha):
    """Return (state, detail_lines). state in {pass, fail, pending, unknown}."""
    if not sha:
        return "unknown", []
    payload = gh(f"repos/{REPO}/actions/runs?head_sha={sha}&per_page=10") or {}
    runs = payload.get("workflow_runs", [])
    if not runs:
        return "unknown", ["CI=unknown (no workflow runs found for this head)"]
    lines = []
    overall = "pass"
    for r in runs[:5]:
        st = r.get("status")              # queued|in_progress|completed|...
        concl = r.get("conclusion") or ""  # success|failure|cancelled|...
        name = r.get("name", "?")
        lines.append(f"CI_RUN={name}:{st}:{concl or ''}")
        if st != "completed":
            if overall == "pass":
                overall = "pending"
        elif concl in NON_GREEN:
            overall = "fail"
            jobs = (gh(f"repos/{REPO}/actions/runs/{r['id']}/jobs") or {}).get("jobs", [])
            for j in jobs:
                if j.get("conclusion") in NON_GREEN:
                    lines.append(f"CI_FAILED_JOB={j.get('name', '?')}:{j.get('id')}")
    return overall, lines


def main():
    pr = gh(f"repos/{REPO}/pulls/{PR}")
    state = (pr or {}).get("state", "unknown")
    head_sha_full = str(((pr or {}).get("head") or {}).get("sha", ""))
    head_sha = head_sha_full[:12]
    if state in ("closed", "merged"):
        print(f"PR_STATE={state} head_sha={head_sha}")
        return

    # ci_check needs the FULL sha: /actions/runs?head_sha= matches exactly.
    ci, ci_lines = ci_check(head_sha_full)
    print(f"PR_STATE={state} head_sha={head_sha}")
    print(f"CI={ci}")
    for line in ci_lines:
        print(line)

    issue_comments = gh(f"repos/{REPO}/issues/{PR}/comments?per_page=100") or []
    review_comments = gh(f"repos/{REPO}/pulls/{PR}/comments?per_page=100") or []

    seen = set()
    if os.path.exists(STATE_FILE):
        try:
            seen = set(json.load(open(STATE_FILE)))
        except Exception:
            seen = set()

    new = []
    for c in issue_comments:
        cid = "issue-" + str(c["id"])
        if cid not in seen:
            seen.add(cid)
            new.append({
                "kind": "issue", "id": cid,
                "author": c["user"]["login"], "created": c["created_at"],
                "body": c.get("body") or "",
            })
    for c in review_comments:
        cid = "review-" + str(c["id"])
        if cid not in seen:
            seen.add(cid)
            new.append({
                "kind": "review", "id": cid,
                "author": c["user"]["login"], "created": c["created_at"],
                "path": c.get("path"), "line": c.get("line") or c.get("original_line"),
                "body": c.get("body") or "",
            })

    try:
        with open(STATE_FILE, "w") as fh:
            json.dump(sorted(seen), fh)
    except Exception:
        pass

    if new:
        print(f"NEW_COMMENTS={len(new)}")
        for c in new:
            print("---COMMENT---")
            print(f"kind={c['kind']} id={c['id']} author={c['author']} created={c['created']}")
            if c.get("path"):
                print(f"path={c['path']} line={c.get('line')}")
            print(c["body"])
    else:
        # Quiet unless a daily heartbeat is due (prove it's alive, don't spam).
        idle_file = STATE_FILE + ".idle"
        today = ""
        try:
            import datetime
            today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            pass
        heartbeat_due = False
        if today:
            last_idle = ""
            try:
                last_idle = open(idle_file).read().strip()
            except Exception:
                pass
            if last_idle != today:
                heartbeat_due = True
                try:
                    with open(idle_file, "w") as fh:
                        fh.write(today)
                except Exception:
                    pass
        print("NO_NEW_COMMENTS")
        if heartbeat_due:
            print("HEARTBEAT_DUE")


if __name__ == "__main__":
    main()