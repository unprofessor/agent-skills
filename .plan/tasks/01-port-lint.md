---
id: port-lint
aliases: [port-lint]
kind: task
parent: port-scripts
title: Port lint.sh to TS (lint.ts + cli/lint.ts)
status: review
assignee: null
created: 2026-07-30
updated: 2026-08-01T07:35:00Z
tags: [port, lint]
depends_on: [cli-scaffolding]
---

## Goal

Port `lint.sh` — the script with the most parsing surface (fm_field, fm_list,
block-style detection, wiki-link extraction, cross-ref checks, cycle DFS) —
onto the typed parser. This is the first script ported because it exercises
every field and every body-parse path; proving it validates the foundation.

## Context

See [[port-scripts]] and the scout inventory (skills/planr/scripts/lint.sh).
The 3-pass structure (per-file → cross-ref → cycle DFS) becomes pure functions
over `ParsedTicket[]` — no IO — which makes the lint logic unit-testable
without a git repo. The block-style `depends_on` check is deleted: a real YAML
lib parses block-style into the same array, so the failure mode no longer
exists. Cycle DFS keeps the self-edge skip from the earlier fix
(skills/planr/scripts/lint.sh, visit()).

## Acceptance

- [x] `src/lint.ts` exports `checkBacklog(tickets: ParsedTicket[]): LintReport`
  (pure, no fs/git) implementing every error/warning class from lint.sh:
  missing/mismatched id, duplicate slug, kind/dir mismatch, invalid status,
  epic-with-parent, story/task-without-parent, dangling parent, dangling
  depends_on, self-dep, depends_on cycle (DFS, each cycle once, self-edges
  skipped); warnings: wrong-kind parent, unresolved `[[wiki-link]]`.
- [x] **Block-style `depends_on` is NOT an error** — the check and its message
  are gone. `depends_on:\n  - a` parses to `["a"]` and gating works.
- [x] `src/cli/lint.ts` drives it: reads the working tree (fs) or a ref
  (`git show` via git.ts), prints `error:`/`warning:` lines + the summary,
  exits 1 on errors / 0 on warnings-or-clean. Matches the exact output format
  the tests grep for (e.g. `depends_on 'ghost-task' does not exist`,
  `depends_on cycle`, `duplicate slug 'http-proxy'`).
- [x] `tests/lint.test.ts` unit-tests `checkBacklog` against fixture
  `ParsedTicket[]` arrays (no git) for every error class and every warning.
- [x] `run-tests.sh` lint-class assertions pass unchanged EXCEPT the
  block-style test, which is rewritten to assert block-style parses correctly
  (exit 0, no "silently disable gating" message) and gating still works.
- [x] Self-dep still reported once (`depends_on itself`), not as a cycle.

## Notes

- 2026-07-30 created. This task is the gateway to the rest of the port — once
  lint is ported and green, the parser is proven against the full check set.

## Validation

All checks performed in worktree at `/home/exfed/projects/wt-port-lint`:

1. **src/lint.ts** — `checkBacklog(inputs: LintInput[]): LintReport` (note: takes
   `LintInput[]` not `ParsedTicket[]` — each input bundles file path + ticket,
   needed because error messages include the file). Pure, no fs/git. Implements
   every error class from lint.sh: missing id, mismatched id, kind/dir mismatch,
   invalid status, epic-with-parent, story/task-without-parent, dangling parent,
   dangling depends_on, self-dep, depends_on cycle (DFS, each cycle once,
   self-edges skipped), duplicate slug. Warnings: wrong-kind parent, unresolved
   wiki-link.
2. **Block-style depends_on NOT an error** — no check for empty/block-style
   depends_on exists (eemeli/yaml parses both inline and block-style). The
   error class was removed from both `src/lint.ts` and `lint.sh`.
3. **src/cli/lint.ts** — 95 lines, parses argv (optional ref), reads working
   tree (fs) or ref (git ls-tree + showRef via git.ts), prints
   `error:`/`warning:` lines + `lint: N error(s), M warning(s)` summary.
   Exits 1 on errors, 0 on warnings-or-clean. Matches exact output format.
4. **tests/lint.test.ts** — 18 vitest tests covering every error class and warning
   (missing id, mismatched slug, kind/dir mismatch, invalid status, duplicate
   slug, epic-with-parent, missing parent, dangling parent, wrong-kind parent
   warning, dangling depends_on, self-dep, dependency cycle, wiki-link warning,
   block-style parsed correctly, valid statuses, parent null for epic, empty
   backlog).
5. **npm test** — 40/40 passing (22 parse + 18 lint).
6. **npm run build** — produces `dist/cli/lint.cjs` (9.6 KB bundled).
7. **Shim smoke test** — `./scripts/lint.sh` works on the actual `.plan/` backlog
   (finds 1 error + 19 warnings, matches bash lint.sh output). Ref mode works.
8. **run-tests.sh** — 48/48 passing including the rewritten block-style test
   (tests block-style depends_on does NOT error).

One deviation: `checkBacklog` signature uses `LintInput[]` (file + ticket) instead
of raw `ParsedTicket[]`. The acceptance criterion says `ParsedTicket[]` but error
messages must include the file path; adding a `file` field to the input wrapper
preserves purity (no fs/git) while enabling per-file diagnostics.

Also fixed: `Status` type in `src/ticket.ts` was missing `"blocked"` — added it
(matches lint.sh's valid status list).
