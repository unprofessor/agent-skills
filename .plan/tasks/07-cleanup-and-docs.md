---
id: cleanup-and-docs
aliases: [cleanup-and-docs]
kind: task
parent: port-scripts
title: Remove dead bash parsers, delete block-style convention, update docs
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: [cleanup, docs]
depends_on: [port-merge-task]
---

## Goal

Close out the port: delete every remaining awk/sed frontmatter parser, remove
the now-obsolete block-style `depends_on` convention from docs and tests, and
update SKILL.md/references to reflect the TS implementation.

## Context

With all six scripts ported, nothing should depend on inline-only YAML. The
block-style lint error and its test go away (a real YAML lib parses block-style
correctly). SKILL.md's script table and the "block-style is not parsed"
warnings in TICKET-FORMAT.md/PROCESS.md are stale. The "Extracting this skill"
section should note the build step (`npm run build` produces `dist/`) while
reaffirming copy-folder portability (dist is committed/bundled, no npm install
needed at the target).

## Acceptance

- [ ] `grep -rn 'fm_field\|fm_list\|awk .*---\|perl -i -pe' skills/planr/` is
  clean — no bash frontmatter parser remains anywhere.
- [ ] The block-style `depends_on` error class is gone from lint.ts and from
  `run-tests.sh` (test deleted/rewritten in [[port-lint]]; confirm here).
- [ ] TICKET-FORMAT.md: remove "always write the inline `[a, b]` form —
  block-style YAML is not parsed" from the `depends_on` row; note any valid
  YAML list form works.
- [ ] PROCESS.md: remove the block-style bullet from the lint list; keep the
  dangling-slug/cycle/duplicate checks.
- [ ] SKILL.md: script table notes the TS implementation (scripts are shims
  over `dist/cli/*.js`); "Extracting this skill" notes `npm run build` is
  dev-time and the shipped `dist/` is self-contained.
- [ ] `run-tests.sh` passes 40/40 (or the new total after test additions); no
  test references the old bash parsers.
- [ ] A final `npm run build && ./scripts/lint.sh && ./scripts/board.sh`
  smoke test in a clean clone (no `node_modules`) confirms the bundled dist is
  self-contained.

## Notes

- 2026-07-30 created. Depends on [[port-merge-task]] (last script). This is
  the gate to closing [[port-scripts-to-typescript]].
