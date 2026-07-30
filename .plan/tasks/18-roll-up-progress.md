---
id: roll-up-progress
aliases: [roll-up-progress]
kind: task
parent: board-improvements
title: Add roll-up.sh to compute story/epic progress
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: []
depends_on: []
---

## Goal

Add `scripts/roll-up.sh` to compute and display progress for stories and epics by scanning their child tickets and reporting completion ratios and percentages.

## Context

Parent story: [[board-improvements]] under [[bash-era-polish]]. Per the plan data model, “roll-up is derived, never stored” — but there’s currently no command to *compute* the derivation. A leader must manually count child task statuses to estimate story completion.

`roll-up.sh` fills this gap: for each story, scan its child tasks (on trunk) and report how many are in each status; for each epic, scan its child stories’ roll-ups.

## Acceptance

- [ ] `scripts/roll-up.sh` prints a progress table: for each story, its slug, total child tasks, and count per status (done / review / in_progress / todo / blocked)
- [ ] `scripts/roll-up.sh --epics` also rolls up epics from their child stories’ aggregate
- [ ] `scripts/roll-up.sh <story-slug>` shows detail for one story only
- [ ] Reads from trunk (like board.sh), not the working tree, via `git show`
- [ ] Honors `PLANR_DIR` and `PLANR_TRUNK` env vars
- [ ] Column-aligned output, sorted by parent then sort-hint
- [ ] Documented in SKILL.md scripts table
- [ ] Tests added to `tests/run-tests.sh` (create a story with 3 tasks at various statuses, verify roll-up counts)

## Notes

- 2026-07-30 created
- Reuse `fm_field` / `fm_list` patterns from board.sh and lint.sh
- Story’s child tasks = tasks whose `parent:` matches the story slug. Scan trunk via `git ls-tree -r --name-only "$trunk" -- "$plan/tasks"`
- Epic’s child stories = stories whose `parent:` matches the epic slug
- Format example:
  ```
  ## story progress
  parser-foundation     0/0  (no tasks)
  port-scripts          0/6   0% done, 0% in_progress, 0% review
  worker-resumption     0/2   0% done
  ```
