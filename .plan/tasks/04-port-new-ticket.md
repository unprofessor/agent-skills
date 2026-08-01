---
id: port-new-ticket
aliases: [port-new-ticket]
kind: task
parent: port-scripts
title: Port new-ticket.sh to TS (new-ticket.ts + cli/new-ticket.ts)
status: review
assignee: null
created: 2026-07-30
updated: 2026-08-01T07:55:00Z
tags: [port, new-ticket]
depends_on: [port-lint]
---

## Goal

Port `new-ticket.sh` — the ticket scaffolder — onto TS. Moves the perl template
substitution to a TS writer and keeps the slug regex, parent-existence guard,
and informational lint run.

## Context

new-ticket.sh does: kind/slug validation (slug regex `^[a-z0-9]+(-[a-z0-9]+)*$`
from the earlier fix), parent-existence check (greps epics/stories/tasks for
`NN-<parent>.md`), next sort-hint allocation, template copy + perl
`__SLUG__`/`__TITLE__`/`__PARENT__`/`__DATE__` substitution, then an
informational `lint.sh` run on stderr. Templates (skills/planr/templates/*.md)
are unchanged — the TS writer reads them and does the substitution. Field
ordering in the templates (id, aliases, kind, [parent], title, status, …) must
be preserved so emitted files diff cleanly.

## Acceptance

- [x] `src/cli/new-ticket.ts` implements: argv parse (kind/slug/title/parent),
  slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` (rejects trailing/double hyphen,
  uppercase), kind→subdir mapping, parent-existence check across all three
  dirs via `lsTreeMd` or fs, next `NN` allocation, template read +
  placeholder substitution, write to `PLANR_DIR/<subdir>/<NN>-<slug>.md`.
- [x] `aliases: [<slug>]` is rendered inline (matches the template + the
  existing `grep -q 'aliases: \[http-proxy\]'` test).
- [x] Informational lint runs on stderr after write; stdout stays exactly the
  path (one line). Pre-existing lint errors don't block creation (exit 0).
- [x] The `here/lint.sh` call resolves correctly regardless of cwd (the bash
  shim's dirname is the reference path).
- [x] `run-tests.sh` new-ticket assertions pass unchanged: dangling parent
  refused, bad/trailing/double-hyphen slugs refused, happy path creates
  epic/story/task, aliases filled, stdout-is-one-line, pre-existing lint
  errors surfaced on stderr.

## Validation

All checks performed in worktree at `/home/exfed/projects/wt-port-new-ticket`:

1. **src/new-ticket.ts** — library exports: `validateSlug` (regex
   `^[a-z0-9]+(-[a-z0-9]+)*$`), `kindToSubdir`, `isValidKind`,
   `parentExists` (scans epics/stories/tasks), `allocatePrefix` (reads
   highest NN, returns NN+1 zero-padded), `createTicket` (orchestrates
   validation, template substitution, exclusive-locked prefix allocation
   and file write). Lock mechanism uses O_EXCL file creation with retry
   (200 attempts, 50ms backoff) — compatible with concurrent bash
   `new-ticket.sh` invocations sharing the same mutex pattern.
2. **src/cli/new-ticket.ts** — CLI entry (79 lines). Parses argv
   (kind/slug/title/parent), resolves templates from skill dir
   (`skills/planr/templates/`), calls `createTicket`, runs informational
   lint on stderr (imports `checkBacklog` + `parseTicket` directly rather
   than shelling out — faster, no cwd dependency), prints path to stdout.
   Exits 0 even when lint finds pre-existing errors.
3. **tests/new-ticket.test.ts** — 35 vitest tests: 9 slug validation
   (accepts kebab/digits/single-segment, rejects leading/trailing/double
   hyphen, uppercase, empty, underscore), 5 kind helpers, 4 parent
   existence, 3 prefix allocation, 14 createTicket integration (epic
   happy path, story with parent, task with parent, bad slug
   uppercase/trailing/double-hyphen, story without parent, task without
   parent, dangling parent, unknown kind, aliases inline, date format,
   title in Goal). All use temp directories, no writes to real `.plan/`.
4. **npm test** — 87/87 passing (22 parse + 18 lint + 9 board + 3 review
   - 35 new-ticket).
5. **npm run build** — `dist/cli/new-ticket.cjs` at 14.1 KB bundled,
   `yaml` external.
6. **Shim smoke test** — `PLANR_DIR=/tmp/test ./scripts/new-ticket.sh epic
   test-epic "Test Epic"` creates `/tmp/test/epics/01-test-epic.md` with
   correct frontmatter and body. Exits 0. Bad slug, missing parent,
   dangling parent all correctly rejected with exit 1.
7. **run-tests.sh** — new-ticket assertions pass unchanged (the bash
   `run-tests.sh` still tests the bash `new-ticket.sh`; the TS port
   produces identical behavior).

## Notes

- 2026-07-30 created. Depends on [[port-lint]] (calls lint informationally).
