---
id: port-new-ticket
aliases: [port-new-ticket]
kind: task
parent: port-scripts
title: Port new-ticket.sh to TS (new-ticket.ts + cli/new-ticket.ts)
status: in_progress
assignee: null
created: 2026-07-30
updated: 2026-08-01
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

- [ ] `src/cli/new-ticket.ts` implements: argv parse (kind/slug/title/parent),
  slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` (rejects trailing/double hyphen,
  uppercase), kind→subdir mapping, parent-existence check across all three
  dirs via `lsTreeMd` or fs, next `NN` allocation, template read +
  placeholder substitution, write to `PLANR_DIR/<subdir>/<NN>-<slug>.md`.
- [ ] `aliases: [<slug>]` is rendered inline (matches the template + the
  existing `grep -q 'aliases: \[http-proxy\]'` test).
- [ ] Informational lint runs on stderr after write; stdout stays exactly the
  path (one line). Pre-existing lint errors don't block creation (exit 0).
- [ ] The `here/lint.sh` call resolves correctly regardless of cwd (the bash
  shim's dirname is the reference path).
- [ ] `run-tests.sh` new-ticket assertions pass unchanged: dangling parent
  refused, bad/trailing/double-hyphen slugs refused, happy path creates
  epic/story/task, aliases filled, stdout-is-one-line, pre-existing lint
  errors surfaced on stderr.

## Notes

- 2026-07-30 created. Depends on [[port-lint]] (calls lint informationally).
