---
id: port-claim
aliases: [port-claim]
kind: task
parent: port-scripts
title: Port claim.sh to TS (claim.ts + cli/claim.ts)
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: [port, claim, mutating]
depends_on: [port-new-ticket, port-board]
---

## Goal

Port `claim.sh` — the first mutating git script — onto TS. Creates the worktree
branch, verifies cross-ticket `depends_on` are all `done` on trunk, flips
`status: in_progress` + bumps `updated:`, commits. Highest-risk port after
merge-task, so it lands late with the foundation proven.

## Context

claim.sh reads depends_on (inline awk) + each dep's status (cross-directory
resolution via `git ls-tree` over epics/stories/tasks), refuses with blockers
if any dep isn't `done`, then `git worktree add -b plan/<slug>`, and `sed -i`
flips status + updated. Two silent-failure modes to fix: the sed is
replace-only (silent no-op if `status:` absent → port inserts-if-absent) and
unscoped to frontmatter (a body `status: ` line could be rewritten → port
scopes writes to the frontmatter block). The informational lint run on stderr
stays.

## Acceptance

- [ ] `src/cli/claim.ts` implements: locate task file on trunk
  (`lsTreeMd(trunk, tasks)` + slug match), informational lint on stderr,
  parse depends_on via `parseTicket`, resolve each dep slug across all three
  dirs, read each dep's status, refuse with `<slug>(<status>)` blockers if any
  not `done` (exact message format: `refuse claim: '<slug>' has unfinished
  depends_on: ...`).
- [ ] `git worktree add -b plan/<slug> <wt> <trunk>` via `worktreeAdd`.
- [ ] Flip `status: in_progress` and `updated: <date>` via a frontmatter-scoped
  writer (insert-if-absent, not replace-only; scope to the frontmatter block
  so body lines are never touched). Commit via `commit`.
- [ ] stdout is exactly the worktree path (one line).
- [ ] `run-tests.sh` claim assertions pass: cross-story dep refused while not
  done (names `http-proxy(todo)`), succeeds once dep done (prints
  `wt-wire-cli`).

## Notes

- 2026-07-30 created. Depends on [[port-new-ticket]] (lint invocation pattern)
  and [[port-board]] (cross-dir dep resolution pattern). Mutating — test
  carefully in the throwaway repo.
