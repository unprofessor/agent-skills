---
id: port-new-ticket
aliases: [port-new-ticket]
kind: task
parent: port-scripts
title: Port new-ticket.sh to TS (new-ticket.ts + cli/new-ticket.ts)
status: in_progress
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

## Review

verdict: changes-requested

### What I checked

- **src/new-ticket.ts** (234 lines) — `validateSlug` (regex
  `^[a-z0-9]+(-[a-z0-9]+)*$`), `kindToSubdir`, `isValidKind`, `parentExists`
  (scans epics/stories/tasks), `allocatePrefix` (highest NN + 1, zero-padded),
  `createTicket` (validation → template substitution → locked
  allocate-and-write → collision re-scan). Correct, matches bash logic.
- **src/cli/new-ticket.ts** — argv parse, template dir resolution from
  `skills/planr/templates/` with dev fallback, in-process informational lint
  on stderr, stdout exactly one line. Works.
- **tests/new-ticket.test.ts** — 35 tests, all temp-dir based, no real
  `.plan/` writes. Pass.
- **npm test** — 87/87 passing (22 parse + 18 lint + 9 board + 3 review + 35
  new-ticket). **npm run build** — dist/cli/new-ticket.cjs (14.3 KB).
- **End-to-end in throwaway git repo** (`git init`, `.plan/{epics,stories,tasks}`):
  task without parent rejected (exit 1), task with parent creates
  `.plan/tasks/01-my-task.md` with correct frontmatter, prefix allocation
  advances 01→02→03, dangling parent rejected, stdout one line. Pass.
- **TS-vs-TS concurrency** — 20 parallel `./scripts/new-ticket.sh` invocations
  produced 20 unique prefixes. Pass (self-serializes).

### Blocker

- **Lock mechanism does not match bash flock behavior** (src/new-ticket.ts
  `flockExclusive`, lines 98-143). Bash `_lock.sh` takes an exclusive
  `flock -x` on `<git-common-dir>/planr.lock`; the TS port instead O_EXCL-creates
  `<git-common-dir>/planr.lock.mutex` (line 112: `const mutexFile =`${lp}.mutex`;`)
  with a 200×50ms retry loop. Different file AND different mechanism — the two
  do not coordinate. Reproduced: 30 parallel invocations (15 bash
  `skills/planr/scripts/new-ticket.sh` + 15 TS) in one repo produced 30 files
  with only 27 unique prefixes — colliding sort-hints 04, 07, 12 — and 3 bash
  runs died with `internal error: prefix NN is shared by 2 files`. The bash and
  TS writers are not mutually exclusive, and `merge-task.sh` (also exclusive
  flock on `planr.lock`) races the TS writer too.

### Required fix

- Use a real `flock` on `<git-common-dir>/planr.lock` (same file as bash
  `_lock.sh`) around prefix allocation + write — e.g. run the critical section
  under a spawned `flock -x <planr.lock> ...` child (flock is already a hard
  dependency of the skill). O_EXCL-create on a `.mutex` file cannot be made
  compatible with advisory flock on `planr.lock` (bash's `exec 9>"$lf"` leaves
  the file on disk, so existence-based locking on the same path would always
  EEXIST). Note the port's own comment (lines 102-110) claims fd inheritance
  prevents flock use — that is only true for fds opened in the parent; a
  spawned `flock` child holds the kernel lock correctly.

### Notes

- Residual risk even after fix: O_EXCL mutex leaves a stale `.mutex` file if the
  process is killed mid-critical-section, permanently wedging new-ticket until
  manual cleanup; flock auto-releases on process death.
- Everything else (slug/parent validation, substitution, prefix allocation,
  CLI, tests, build, end-to-end) is correct and can be re-verified unchanged
  once the lock is replaced.

## Notes

- 2026-07-30 created. Depends on [[port-lint]] (calls lint informationally).
