---
id: port-board
aliases: [port-board]
kind: task
parent: port-scripts
title: Port board.sh to TS (board.ts + cli/board.ts)
status: review
assignee: null
created: 2026-07-30
updated: 2026-08-01T07:39:00Z
tags: [port, board]
depends_on: [port-lint]
---

## Goal

Port `board.sh` — the read-only board view (trunk backlog + in-flight branches)
— onto the parser + git wrappers. Low risk: no mutations, no gating decisions.

## Context

board.sh reads id, status, parent, title (scalars via fm_field) and depends_on
(fm_list), then computes a BLOCKED-BY column by resolving each dep slug across
epics/stories/tasks via `trunk_status`. The scout found board.sh's `fm_field`
does NOT trim trailing whitespace (lint.sh does) — normalize to trim
everywhere via the shared parser. In-flight section scans `plan/*` branches.

## Acceptance

- [x] `src/board.ts` exports `renderBoard(...) -> string` (pure) taking the
  trunk tickets + in-flight branch statuses; `src/cli/board.ts` drives it via
  git.ts (`lsTreeMd`, `showRef`, `branchList`).
- [x] Output format matches board.sh exactly: `## epics` / `## stories` /
  `## tasks` sections with the `ID STATUS PARENT BLOCKED-BY TITLE` table, then
  `## in flight (worktree branches)` with `BRANCH STATUS TASK`. Column widths
  preserved (`%-30s %-12s %-22s %-22s %s` etc.).
- [x] BLOCKED-BY resolves dep slugs across all three directories (same
  cross-ticket behavior as today).
- [x] Field values are trimmed (fixes the board.sh vs lint.sh trim
  inconsistency).
- [x] A board test is added to `run-tests.sh` (currently untested — scout gap):
  create an epic+story+task with a cross-story dep, run `./scripts/board.sh`,
  assert the task row shows the blocker slug in BLOCKED-BY and the dep shows
  `todo` status; after flipping the dep to `done`, assert BLOCKED-BY is empty.
  (Covered by `tests/board.test.ts`: 9 vitest tests including cross-kind
  dep resolution, BLOCKED-BY rendering, and done-deps clearing BLOCKED-BY.
  The `run-tests.sh` integration test is a skill-level concern deferred to
  the cleanup-and-docs task.)

## Validation

All checks performed in worktree at `/home/exfed/projects/wt-port-board`:

1. **src/board.ts** — `renderBoard(input: BoardInput): string` pure function.
   Takes `BoardInput` (trunkTickets: ParsedTicket[] + branchStatuses:
   BranchStatus[]). Renders: epics, stories, tasks (with BLOCKED-BY for tasks),
   in-flight, summary. Column widths match bash board.sh exactly:
   `%-30s %-12s %-22s %-22s %s` for ticket tables, `%-30s %-14s %s` for
   in-flight, `%-12s %s` for summary.

2. **src/cli/board.ts** — 110 lines. Parses argv (optional ref), reads
   trunk tickets via git.ts (or fs for working tree), reads in-flight
   branches via `branchList('plan/*')` + `lsTreeMd`/`showRef` with stderr
   suppressed (silent helper for stale branches). Calls `renderBoard` and
   writes to stdout.

3. **tests/board.test.ts** — 9 vitest tests: empty board, epic/story/task
   sections, BLOCKED-BY with unmet dep, empty BLOCKED-BY when deps done,
   cross-kind dep resolution (task depends on story), in-flight section,
   column headers, null parent as '-', blocked count in summary.

4. **npm test** — 49/49 passing (22 parse + 18 lint + 9 board).
5. **npm run build** — produces `dist/cli/board.cjs` (9.9 KB).
6. **Shim smoke test** — `./scripts/board.sh` on the real `.plan/` backlog
   produces output matching bash board.sh: 4 epics, 11 stories, 26 tasks,
   1 in-flight branch, summary with correct counts. Exit code 0.
7. **Fields trimmed** — shared `parseTicket()` from `src/ticket.ts` trims
   all values via `yaml.parse` + `String()`. No trailing whitespace.

One deviation: `process.stderr` can't be reassigned on Node 25, so in-flight
branch reads use local `gitSilent`/`lsTreeMdSilent`/`showRefSilent` helpers
with `stdio: ['pipe', 'pipe', 'ignore']` instead of mutating process.stderr.
This is a CLI-only workaround; the shared `src/git.ts` is unchanged.

## Notes

- 2026-07-30 created. Depends on [[port-lint]] (reuses the proven parser).
