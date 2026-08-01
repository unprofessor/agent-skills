---
id: port-claim
aliases: [port-claim]
kind: task
parent: port-scripts
title: Port claim.sh to TS (claim.ts + cli/claim.ts)
status: review
assignee: null
created: 2026-07-30
updated: 2026-08-01T10:45:00Z
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
unscoped to frontmatter (a body `status:` line could be rewritten → port
scopes writes to the frontmatter block). The informational lint run on stderr
stays.

## Acceptance

- [x] `src/cli/claim.ts` implements: locate task file on trunk
  (`lsTreeMd(trunk, tasks)` + slug match), informational lint on stderr,
  parse depends_on via `parseTicket`, resolve each dep slug across all three
  dirs, read each dep's status, refuse with `<slug>(<status>)` blockers if any
  not `done` (exact message format: `refuse claim: '<slug>' has unfinished
  depends_on: ...`).
- [x] `git worktree add -b plan/<slug> <wt> <trunk>` via `worktreeAdd`.
- [x] Flip `status: in_progress` and `updated: <date>` via a frontmatter-scoped
  writer (insert-if-absent, not replace-only; scope to the frontmatter block
  so body lines are never touched). Commit via `commit`.
- [x] stdout is exactly the worktree path (one line).
- [x] `run-tests.sh` claim assertions pass: cross-story dep refused while not
  done (names `http-proxy(todo)`), succeeds once dep done (prints
  `wt-wire-cli`).

## Validation

All checks performed in worktree at `/home/exfed/projects/wt-port-claim`:

1. **src/claim.ts** — `claimTask(input: ClaimInput): string` runs the whole
   claim under a **shared** `flock -s <git-common-dir>/planr.lock` via a
   spawned `flock ... node -e` child — the same file and mechanism as bash
   `_lock.sh`'s `planr_lock_shared`, so TS and bash writers serialize
   (empirically confirmed: a TS claim blocked ~1.5s while a bash exclusive
   `flock -x` writer held the lock, then completed). The child inlines the
   parse (mirrors parseTicket for inline `[a, b]`, bare string, and
   block-style YAML `depends_on`) because a self-contained critical section
   cannot import TS modules. `cwd` option added so library callers (tests)
   can target a throwaway repo; lock path resolved absolute against cwd.
2. **Behavior parity with bash claim.sh** (verified side-by-side in a
   throwaway repo):
   - refusal: `refuse claim: 'wire-cli' has unfinished depends_on:
     http-proxy(todo)` + `resolve or complete these first, or have the leader
     update depends_on.` on stderr, exit 1 — byte-identical to bash;
   - success: stdout is exactly `../wt-wire-cli`, exit 0 — byte-identical;
   - no-task-file: `no task file for slug 'x' on main`, exit 1;
   - informational lint of trunk runs on stderr (pipied from the lint CLI's
     stdout, matching bash's `lint.sh "$trunk" >&2 || true`).
3. **Silent-failure-mode fixes (both verified in throwaway repos):**
   - frontmatter-scoped write: a body line `status: this-is-a-body-line...`
     was untouched after claim; only the frontmatter `status:`/`updated:`
     lines changed;
   - insert-if-absent: a task with NO `status:` in frontmatter got
     `status: in_progress` inserted at the top of the frontmatter block;
   - worktree commit: `plan: claim <slug> (in_progress)` on branch
     `plan/<slug>` off trunk; trunk task file unchanged.
4. **tests/claim.test.ts** — 7 vitest tests (4 library + 3 CLI via
   `dist/cli/claim.cjs` in throwaway git repos, cleaned up after): refusal
   with blocker names, success flip + updated bump + branch/worktree creation,
   block-style depends_on gating still enforced, no-task-file error, CLI exit
   codes + stdout/stderr contract. All 94 tests pass (22 parse + 18 lint + 9
   board + 3 review + 35 new-ticket + 7 claim).
5. **npm run build** — `dist/cli/claim.cjs` (8.6 KB) bundles claim.ts + git
   helpers; the `flock` child runs from the built bundle (shim chain
   `scripts/claim.sh` → `dist/cli/claim.cjs` verified end-to-end).
6. **npx tsc --noEmit** — clean.
7. **Duplicate-claim error** (branch already exists): surfaces git's last
   stderr line cleanly (`fatal: a branch named 'plan/wire-cli' already
   exists`), exit 1 — no node stack dump (child git helper catches and
   re-emits; explicit pipe stdio prevents stderr duplication).

One deviation: `parse depends_on via parseTicket` — the flocked child inlines
an equivalent parser (inline/block-style YAML) instead of importing
`parseTicket`, because the critical section is a self-contained `node -e`
script (same pattern as `LOCKED_WRITE_SCRIPT` in new-ticket.ts). The parse
behavior matches parseTicket and is covered by the block-style test.

## Notes

- 2026-07-30 created. Depends on [[port-new-ticket]] (lint invocation pattern)
  and [[port-board]] (cross-dir dep resolution pattern). Mutating — test
  carefully in the throwaway repo.
- 2026-08-01 implemented. Shared flock via spawned `flock -s` child (matches
  bash `planr_lock_shared`); explicit pipe stdio required to avoid
  execFileSync's default stderr leak duplicating error output.
