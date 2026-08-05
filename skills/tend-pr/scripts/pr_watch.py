#!/usr/bin/env python3
"""PR watcher for the tend-pr skill.

Polls a GitHub PR's state + comments + CI status. Emits a printer-friendly
record to stdout that the cron agent turns into drafts. Important: the script
itself dedupes on a stable fingerprint (head_sha + pr_state + ci state + ci
runs + comments), so identical ticks produce NO output - the agent silence
rule then carries the rest of the day. Only emits on delta.

Self-cleanup signal: PR_STATE=closed or PR_STATE=merged (always emitted).

CI is read via the REST Actions API (`/actions/runs?head_sha=...`) rather
than check-runs/GraphQL, because a fork-scoped or fine-grained token may NOT
have `checks:read`, while actions read is commonly available. If the run
list can't be read, CI=unknown is reported (never silently assumed green).

Usage: set REPO/PR at the top (and optionally STATE_FILE), then run directly
(python3 pr_watch.py) or from a cronjob. Re-runs are safe / idempotent.
"""
import hashlib
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
    """Return (state, detail_lines, runs_fingerprint)."""
    if not sha:
        return "unknown", [], ""
    payload = gh(f"repos/{REPO}/actions/runs?head_sha={sha}&per_page=10") or {}
    runs = payload.get("workflow_runs", [])
    if not runs:
        return "unknown", ["CI=unknown (no workflow runs found for this head)"], ""
    lines = []
    overall = "pass"
    fp_runs = []
    for r in runs[:5]:
        st = r.get("status")              # queued|in_progress|completed|...
        concl = r.get("conclusion") or ""  # success|failure|cancelled|...
        name = r.get("name", "?")
        run_id = r.get("id")
        lines.append(f"CI_RUN={name}:{st}:{concl or ''}:{run_id}")
        fp_runs.append(f"{name}:{st}:{concl}:{run_id}")
        if st != "completed":
            if overall == "pass":
                overall = "pending"
        elif concl in NON_GREEN:
            overall = "fail"
            jobs = (gh(f"repos/{REPO}/actions/runs/{r['id']}/jobs") or {}).get("jobs", [])
            for j in jobs:
                if j.get("conclusion") in NON_GREEN:
                    lines.append(f"CI_FAILED_JOB={j.get('name', '?')}:{j.get('id')}")
    return overall, lines, "|".join(sorted(fp_runs))


def compute_fingerprint(pr_state, head_sha, ci_state, runs_fp):
    """Stable SHA1 of the things the author cares about. Any change -> ping."""
    payload = f"{pr_state}|{head_sha}|{ci_state}|{runs_fp}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def load_state():
    """Return (set_of_seen_comment_ids, last_fingerprint_or_None).

    Migrates older list-only state files transparently."""
    seen, last_fp = set(), None
    if not os.path.exists(STATE_FILE):
        return seen, last_fp
    try:
        raw = json.load(open(STATE_FILE))
    except Exception:
        return seen, last_fp
    if isinstance(raw, list):                    # legacy schema
        seen = set(raw)
    elif isinstance(raw, dict):
        seen = set(raw.get("comments") or [])
        last_fp = raw.get("fingerprint")
    return seen, last_fp


def save_state(seen, fingerprint):
    """Write new schema; best-effort (do not break the run on a write error)."""
    try:
        with open(STATE_FILE, "w") as fh:
            json.dump({"comments": sorted(seen), "fingerprint": fingerprint}, fh)
    except Exception:
        pass


def main():
    pr = gh(f"repos/{REPO}/pulls/{PR}")
    pr_state = (pr or {}).get("state", "unknown")
    head_sha_full = str(((pr or {}).get("head") or {}).get("sha", "") or "")
    head_sha_short = head_sha_full[:12]
    if pr_state in ("closed", "merged"):
        # Self-cleanup signal: ALWAYS emit, even if unchanged, so the agent tears down.
        print(f"PR_STATE={pr_state} head_sha={head_sha_short}")
        return

    ci_state, ci_lines, runs_fp = ci_check(head_sha_full)
    new_fingerprint = compute_fingerprint(pr_state, head_sha_full, ci_state, runs_fp)

    seen_comments, last_fingerprint = load_state()

    # Pull comment lists. Don't add to `seen` until AFTER we compute the delta so
    # a failed write doesn't accidentally dedupe fresh comments.
    issue_comments = gh(f"repos/{REPO}/issues/{PR}/comments?per_page=100") or []
    review_comments = gh(f"repos/{REPO}/pulls/{PR}/comments?per_page=100") or []
    all_comments = []
    for c in issue_comments:
        all_comments.append(("issue-" + str(c["id"]), {
            "kind": "issue", "id": "issue-" + str(c["id"]),
            "author": c["user"]["login"], "created": c["created_at"],
            "body": c.get("body") or "",
        }))
    for c in review_comments:
        all_comments.append(("review-" + str(c["id"]), {
            "kind": "review", "id": "review-" + str(c["id"]),
            "author": c["user"]["login"], "created": c["created_at"],
            "path": c.get("path"), "line": c.get("line") or c.get("original_line"),
            "body": c.get("body") or "",
        }))

    new_comments = [info for cid, info in all_comments if cid not in seen_comments]
    new_seen = seen_comments | {cid for cid, _ in all_comments}

    state_changed = (new_fingerprint != last_fingerprint) or bool(new_comments)
    # Save (stamp + dedupe set) regardless; the daily-heartbeat flag reads from a sidecar.
    save_state(new_seen, new_fingerprint)

    if not state_changed:
        # Anti-spam primary path: nothing changed since last tick.
        # Allow exactly ONE heartbeat per UTC day (writes to <state>.idle if not already today).
        try:
            import datetime
            today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            today = ""
        if today:
            idle_file = STATE_FILE + ".idle"
            last_idle = ""
            try:
                last_idle = open(idle_file).read().strip()
            except Exception:
                pass
            if last_idle != today:
                try:
                    with open(idle_file, "w") as fh:
                        fh.write(today)
                except Exception:
                    pass
                print(f"PR_STATE={pr_state} head_sha={head_sha_short}")
                print(f"CI={ci_state}")
                for line in ci_lines:
                    print(line)
                print("STATE_DELTA=no NO_NEW_COMMENTS HEARTBEAT_DUE")
        return

    # Something IS different. Emit the full record so the agent can act.
    print(f"PR_STATE={pr_state} head_sha={head_sha_short}")
    print(f"CI={ci_state}")
    for line in ci_lines:
        print(line)
    print(f"STATE_DELTA=yes prior_fingerprint={last_fingerprint or 'none'}")
    if new_comments:
        print(f"NEW_COMMENTS={len(new_comments)}")
        for info in new_comments:
            print("---COMMENT---")
            print(f"kind={info['kind']} id={info['id']} author={info['author']} created={info['created']}")
            if info.get("path"):
                print(f"path={info['path']} line={info.get('line')}")
            print(info["body"])
    else:
        # State changed (probably head SHA moved or CI rolled) but no new comments.
        print("NO_NEW_COMMENTS")


if __name__ == "__main__":
    main()
