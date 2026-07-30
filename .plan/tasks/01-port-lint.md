---
id: port-lint
aliases: [port-lint]
kind: task
parent: port-scripts
title: Port lint.sh to TS (lint.ts + cli/lint.ts)
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
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

- [ ] `src/lint.ts` exports `checkBacklog(tickets: ParsedTicket[]): LintReport`
  (pure, no fs/git) implementing every error/warning class from lint.sh:
  missing/mismatched id, duplicate slug, kind/dir mismatch, invalid status,
  epic-with-parent, story/task-without-parent, dangling parent, dangling
  depends_on, self-dep, depends_on cycle (DFS, each cycle once, self-edges
  skipped); warnings: wrong-kind parent, unresolved `[[wiki-link]]`.
- [ ] **Block-style `depends_on` is NOT an error** — the check and its message
  are gone. `depends_on:\n  - a` parses to `["a"]` and gating works.
- [ ] `src/cli/lint.ts` drives it: reads the working tree (fs) or a ref
  (`git show` via git.ts), prints `error:`/`warning:` lines + the summary,
  exits 1 on errors / 0 on warnings-or-clean. Matches the exact output format
  the tests grep for (e.g. `depends_on 'ghost-task' does not exist`,
  `depends_on cycle`, `duplicate slug 'http-proxy'`).
- [ ] `tests/lint.test.ts` unit-tests `checkBacklog` against fixture
  `ParsedTicket[]` arrays (no git) for every error class and every warning.
- [ ] `run-tests.sh` lint-class assertions pass unchanged EXCEPT the
  block-style test, which is rewritten to assert block-style parses correctly
  (exit 0, no "silently disable gating" message) and gating still works.
- [ ] Self-dep still reported once (`depends_on itself`), not as a cycle.

## Notes

- 2026-07-30 created. This task is the gateway to the rest of the port — once
  lint is ported and green, the parser is proven against the full check set.
