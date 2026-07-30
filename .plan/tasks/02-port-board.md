---
id: port-board
aliases: [port-board]
kind: task
parent: port-scripts
title: Port board.sh to TS (board.ts + cli/board.ts)
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
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

- [ ] `src/board.ts` exports `renderBoard(...) -> string` (pure) taking the
  trunk tickets + in-flight branch statuses; `src/cli/board.ts` drives it via
  git.ts (`lsTreeMd`, `showRef`, `branchList`).
- [ ] Output format matches board.sh exactly: `## epics` / `## stories` /
  `## tasks` sections with the `ID STATUS PARENT BLOCKED-BY TITLE` table, then
  `## in flight (worktree branches)` with `BRANCH STATUS TASK`. Column widths
  preserved (`%-30s %-12s %-22s %-22s %s` etc.).
- [ ] BLOCKED-BY resolves dep slugs across all three directories (same
  cross-ticket behavior as today).
- [ ] Field values are trimmed (fixes the board.sh vs lint.sh trim
  inconsistency).
- [ ] A board test is added to `run-tests.sh` (currently untested — scout gap):
  create an epic+story+task with a cross-story dep, run `./scripts/board.sh`,
  assert the task row shows the blocker slug in BLOCKED-BY and the dep shows
  `todo` status; after flipping the dep to `done`, assert BLOCKED-BY is empty.

## Notes

- 2026-07-30 created. Depends on [[port-lint]] (reuses the proven parser).
