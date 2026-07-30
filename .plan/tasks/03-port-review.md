---
id: port-review
aliases: [port-review]
kind: task
parent: port-scripts
title: Port review.sh to TS (review.ts + cli/review.ts)
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: [port, review]
depends_on: [port-lint]
---

## Goal

Port `review.sh` — the read-only reviewer brief (branch, worktree, acceptance
+ validation sections, diff, guidance) — onto the typed body parser.

## Context

review.sh extracts `## Acceptance` and `## Validation` sections with an awk
state machine on `^## ` (turns on at `^## <Name>`, off at the next `^## `),
and strips blank lines from validation. These map directly to
`extractSection(body, name)`. The reviewer guidance block is a static
heredoc. review.sh is currently UNTESTED by run-tests.sh (scout gap) — this
task adds coverage.

## Acceptance

- [ ] `src/cli/review.ts` uses `showRef(branch, path)` + `parseTicket` +
  `extractSection` to print branch, task path, worktree (from `worktreeList`),
  `--- acceptance ---`, `--- validation (worker self-check) ---`, the diff
  (`diffRefs`), and the static reviewer guidance.
- [ ] Section extraction matches: heading line excluded, content until the next
  `^## ` line, validation blank-lines stripped.
- [ ] Output format matches review.sh exactly (same labels, same heredoc
  guidance text).
- [ ] A review test is added to `run-tests.sh`: create a task with `##
  Acceptance` and `## Validation` content, flip to `review`, run
  `./scripts/review.sh`, assert both sections' content appears and the diff
  vs trunk is shown.

## Notes

- 2026-07-30 created. Depends on [[port-lint]] for the parser. Can run in
  parallel with [[port-board]] (both read-only, independent).
