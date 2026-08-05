---
name: tend-pr
description: "Tend an open PR: poll comments, draft gated replies."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [GitHub, Pull-Requests, code-review, automation, cron]
    related_skills: [github-pr-workflow, github-code-review]
---

# Tend a PR (review-comment polling)

Sweep an open PR for new reviewer comments and drive each to resolution - but on
PRs in OTHER people's/orgs' repos (e.g. NousResearch upstream), ONLY draft
replies and patches; never auto-post or auto-push without the author's sign-off.

This is complementary to `github-pr-workflow` (which covers create/CI/merge).
This skill is about the **review loop** once a PR is open.

## When to use

- A PR you helped author is open and reviewers (including automated Copilot
  review) are commenting.
- You want continuous, low-cost visibility into new review comments without a
  long-lived shell loop tying up a session.
- The author wants to stand behind every comment that goes out under their name.

## Core concept: a cron-polled watcher, gated authoring

Rather than a blocking loop, schedule a **cronjob** that runs the bundled watcher
script every N minutes. The script reads PR state + comments, dedupes against a
state file, and prints `PR_STATE` plus any NEW comments to stdout. The cron agent
turns those into **drafts** posted to the author's thread for sign-off.

Why a separate script + cron (not ad-hoc gh calls):
- `gh api` each tick is fast and the state file makes it idempotent (no re-post).
- The cron job is durable and does not consume the interactive session.
- Self-cleanup on merge is automatic (the job removes itself).

## Bundled script

`scripts/pr_watch.py` - drop-in poller. Set REPO/PR at the top. It prints to
It prints to stdout a machine/agent-friendly record:

```
PR_STATE=open head_sha=...     # or closed / merged
CI=pass                        # pass | fail | pending | unknown
CI_RUN=Validate:completed:success   # one per run: NAME:STATUS:CONCLUSION
CI_FAILED_JOB=validate-shell:42     # only when a job failed (real job id)
NO_NEW_COMMENTS                 # or NEW_COMMENTS=N + ---COMMENT--- records
```

Dedupe state is kept in a state file (default `/workspace/pr-watch-<pr>.state`);
writes are best-effort. On `PR_STATE=closed|merged` it prints only the state line
so the cron agent knows to tear down.

## Setting up the watcher

1. **Copy the script** where cron can run it (scripts resolve under
   `~/.hermes/scripts/`):
   ```bash
   mkdir -p ~/.hermes/scripts
   cp <skill>/scripts/pr_watch.py ~/.hermes/scripts/pr_watch_<PR>.py
   # edit REPO/PR/STATE_FILE at top
   python3 ~/.hermes/scripts/pr_watch_<PR>.py   # smoke-test; rc=0
   ```
2. **Create the cron job** (via the `cronjob` tool), enabled_toolsets:
   `["terminal","file","cronjob"]`, schedule e.g. `every 15m`. The prompt should
   be fully self-contained (fresh session each run) and encode the policy:
   - Run `python3 ~/.hermes/scripts/pr_watch_<PR>.py`; read stdout.
   - NO_NEW_COMMENTS -> QUIET by default. Send at most ONE short "still
     watching / no new comments" heartbeat per calendar day (UTC) - track the
     last-idle date in a small file (e.g. `<state_file>.idle`) and skip that
     tick if already sent today. Purpose: prove the watcher is alive without
     spamming the thread every 15 min.
   - PR_STATE=closed|merged -> post a short notice to the thread, then remove
     THIS job via `cronjob` list+remove (match by name). Do NOT schedule another.
   - NEW_COMMENTS -> for each, draft a reply + (if warranted) a concrete patch +
     proposed commit message. **Draft-only on org repos: no posting, no push.**
   - CI=fail -> investigate the CI_FAILED_JOB lines, draft a fix (diff +
     commit message) for the author's sign-off, surface the failure in the
     thread; do not auto-push. CI=pending -> wait, never claim green.
     CI=unknown -> note the poller could not read CI. CI=pass -> nothing extra.

## Tending policy

- **Reply to every review comment**, even to disagree or when pushing no code.
- **Org/upstream repos: approval-gated.** Before posting a comment or pushing a
  change, run the exact reply text AND any diff past the author for sign-off.
  Auto-reply is only for repos the author owns outright.
- For each comment: say whether a requested change is correct with reasoning;
  propose an exact `git diff` and a commit message if a change is warranted.
- Work in a git **worktree** on the PR branch; never edit the shared checkout.
  Review your own `git diff --cached` like a reviewer before committing (scan
  for stray artifacts, casing, and anything that looks wrong).
- Commit identity for David's projects: author `David Allen
  <david.allen@columnzero.com>`, `Co-authored-by: Trenton Hermes
  <trenton.hermes@columnzero.com>` trailer.
- Merge-commit workflow: never rebase/squash to rewrite history; update a PR
  branch by merging `main` in, not rebasing.

## Review-comment discipline (apply BEFORE drafting any reply)

A bot or human reviewer's summary is a **starting point**, not an oracle.
Each finding needs verification against the actual code and behaviour before
action.

1. **Pull the full review** (and any inline comments). Review bodies compress
   multiple distinct findings into one summary; do not respond to the summary
   as a single item. Dedupe within and across passes before drafting
   (a finding raised in two passes is one finding).
2. **Pull the PR's actual code** — worktree checkout of the PR head, then
   `git diff <base>...HEAD` for the full surface. Do not reply based on a
   quoted snippet; line numbers, surrounding context, and adjacent flags
   matter.
3. **Open the cited file:line yourself** with read_file or `sed -n`. The
   reviewer's quoted snippet may not match the surrounding code you're
   about to patch — what's at line N+2 before you edit is what matters.
4. **For each finding, classify BEFORE drafting:**
   - **VALID** — code confirms it. Show the citation (path:line) in the reply.
   - **PARTLY VALID** — code shows part of it. State the narrower correct
     remediation; don't gold-plate unrelated bits.
   - **INVALID** — code or behaviour disproves the claim. State the evidence
     in the reply, not just your disagreement.
5. **Prefer empirical proof for dynamic behaviour.** When a claim hinges on
   `set -e` semantics, exit codes, race conditions, hash collisions, runtime
   evaluation order, etc., run a 30-second standalone harness and cite the
   exact output in the reply. A test transcript beats reasoning from first
   principles when both look plausible.
6. **Quote the evidence** — line ranges, exact output snippets, the test you
   wrote. Reply readers can't check your work; you can.

Split findings into fix vs push-back, and **report both** to the author
honestly. It's tempting to "fix" an invalid finding to avoid disagreement, but
that's how you ship non-bugs.

## CI failures

The bundled script reports CI status on every tick (always, whether or not
there are new comments):

- `CI=pass` - every workflow run on the head sha is completed and green. Stay
  quiet (subject to the normal comment/heartbeat rules).
- `CI=pending` - at least one run is still queued/running. Do NOT report the
  branch as green. Stay quiet or note "CI still running"; never claim success.
- `CI=fail` - at least one run failed. Do not stay silent: look at the
  `CI_FAILED_JOB=...` lines (name + real job id) to identify what's broken,
  draft a fix (exact `git diff` + proposed commit message) for the author's
  sign-off, and surface the failure in the thread. Reply to any review comment
  that flagged it. Do not auto-push.
- `CI=unknown` - the poller could not read CI (token lacks actions read, or
  Actions disabled for the repo). Surface this rather than silently assuming
  the branch is green.

CI is read through the REST Actions API (`/actions/runs?head_sha=...`) because
a fork-scoped or fine-grained token may not have `checks:read`; actions read is
more widely available. `unknown` is reported when the run list is unobtainable,
never a fake green.

## Manual one-shot check (no cron)

```bash
python3 ~/.hermes/scripts/pr_watch_<PR>.py
```
Re-runs are safe; already-seen comments are suppressed.

## Removing / pausing the watcher

- `cronjob` action=pause/resume j<id> to stop/start without deleting.
- `cronjob` action=remove j<id> to drop it. The job does this itself on merge.

## Gotchas

- The cron agent runs in a fresh session - the prompt must be self-contained
  (URL, the exact script path, the policy, the identity trailers).
- The state file path must be writable/persistent in the terminal backend
  (e.g. `/workspace`). If it is read-only, dedupe breaks and comments re-surface
  every tick.
- **The bundled script ships with placeholder `REPO = "owner/repo"` and
  `PR = "12345"`.** Copying it to `~/.hermes/scripts/` and forgetting to set the
  real values silently breaks the poll (`gh api` 404 -> `PR_STATE=unknown`, no
  comments ever surfaced). After `cp`, edit REPO/PR, then smoke-test:
  `python3 ~/.hermes/scripts/pr_watch_<PR>.py` must print `PR_STATE=open|closed|merged`.
- The daily heartbeat dedupes on a `<state_file>.idle` file holding the last
  UTC date; delete it to force an immediate heartbeat for testing.
- A fork-scoped `gh` token can READ public org repo PRs/comments and push your
  own fork, but CANNOT create a PR or post comments against the upstream org.
  If the broker can't post, hand the author a ready-to-run `gh api -X POST ...`
  command for each approved reply.