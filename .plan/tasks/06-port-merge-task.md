---
id: port-merge-task
aliases: [port-merge-task]
kind: task
parent: port-scripts
title: Port merge-task.sh to TS (merge-task.ts + cli/merge-task.ts)
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: [port, merge, mutating]
depends_on: [port-claim, port-review]
---

## Goal

Port `merge-task.sh` — the highest-risk script (merges to trunk, mutates
status) — last, when the parser and the claim mutation pattern are proven.
Guards status=review + approved verdict, merges --no-ff, flips to done,
cleans up worktree + branch, handles conflicts with guidance.

## Context

merge-task.sh reads status (inline awk) and the LAST `## Review` block's
`verdict:` (awk state machine, last-wins, no trailing trim — the scout flagged
the untrimmed verdict as a silent-failure mode: `verdict: approved ` would
fail the `== approved` check). The port uses `extractLastReviewVerdict` (which
trims) and a frontmatter-scoped writer for the status→done + updated flip.
Conflict path aborts the merge, lists conflicted files, prints rebase
guidance, leaves worktree+branch intact.

## Acceptance

- [ ] `src/cli/merge-task.ts` implements: locate task file on the branch,
  parse status + verdict; guard `status == review` and `verdict == approved`
  (trimmed), refuse with exact messages otherwise.
- [ ] `git checkout trunk` + `git merge --no-ff <branch>`; on non-zero exit,
  `git merge --abort`, list conflicted files (`git diff --name-only
  --diff-filter=U`), print the rebase guidance (`cd <wt>`, `git rebase
  <trunk>`, `scripts/merge-task.sh <slug>`), exit 1, leave worktree+branch.
- [ ] On success: flip `status: done` + `updated: <date>` via the
  frontmatter-scoped writer (insert-if-absent), commit, `worktreeRemove`,
  `branchDelete`.
- [ ] Verdict parsing: last `## Review` block wins; value trimmed
  (`verdict: approved ` → `approved`); `approved` only (not `approved `).
- [ ] A merge-task test is ADDED to `run-tests.sh` (currently untested — scout
  gap): task with `## Review` + `verdict: approved` + `status: review` merges
  and flips to `done`; a task with `verdict: changes-requested` is refused;
  a task with `status: in_progress` is refused.

## Notes

- 2026-07-30 created. Depends on [[port-claim]] (frontmatter writer pattern)
  and [[port-review]] (verdict extraction). Do this last — it mutates trunk.
