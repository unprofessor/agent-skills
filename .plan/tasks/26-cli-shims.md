---
id: cli-shims
aliases: [cli-shims]
kind: task
parent: cli-scaffolding
title: CLI entry stubs, .sh shims, build config, and smoke test
status: todo
assignee: null
created: 2026-08-01
updated: 2026-08-01
tags: [cli, shims, build, distribution]
depends_on: [parse-core, git-wrappers]
---

## Goal

Wire up the distribution shape: 6 thin CLI entry stubs (`src/cli/*.ts`),
rewrite the 6 `scripts/*.sh` as node shims, update esbuild config to
produce `dist/cli/<name>.js`, and prove the shim → dist → node chain with
a smoke test.

## Context

Parent story: [[cli-scaffolding]]. Pi's node v25.6.1 runs `.ts` natively,
but other harnesses don't, and local-path skills don't run `npm install`.
So the shipped entrypoint is compiled `.js`, bundled by esbuild into
self-contained `dist/cli/<name>.js` (no `node_modules`). `.sh` shims keep
`./scripts/foo.sh` invocation unchanged — zero doc churn during the
migration.

## Acceptance

- [ ] `src/cli/` has one thin entry per script:
  - `board.ts`, `claim.ts`, `lint.ts`, `new-ticket.ts`, `review.ts`,
    `merge-task.ts`
  - Each parses argv (positional + `PLANR_TRUNK`/`PLANR_DIR` env), calls
    library functions, prints, sets exit code
  - Each is <40 lines and does NO parsing logic itself (real logic
    lands in the per-script tasks under [[port-scripts]])
  - Stubs can `console.log` argv — they exist to prove the build +
    shim chain
- [ ] `scripts/*.sh` are rewritten as shims (six files):

  ```bash
  #!/usr/bin/env bash
  exec node "$(dirname "$0")/../dist/cli/<name>.js" "$@"
  ```

  - The six existing script filenames are preserved
  - `chmod +x` on all six
- [ ] `npm run build` (esbuild) produces `dist/cli/<name>.js` for each
  of the six entries, each bundled with the parser + git wrappers,
  `yaml` external, no `node_modules` required at runtime
- [ ] Smoke test: `./scripts/board.sh` in a repo with an empty `.plan/`
  exits 0 and prints nothing, proving the full chain (shim → dist →
  node) works end to end. Add this to `tests/run-tests.sh` or as a new
  `tests/shim.test.ts`.
- [ ] The original bash script logic is NOT deleted — this task only
  adds the shim files, overwriting the existing `scripts/*.sh` (they
  are tracked in the skill source, not the project)

## Notes

- 2026-08-01 created. Depends on [[parse-core]] and [[git-wrappers]]
  (needs both as importable modules for the build). The CLI stubs are
  intentionally trivial — real logic lands in the [[port-scripts]] tasks.
  The shim overwrite is the first mutation of `scripts/`; the original
  bash is preserved in the planr skill source at
  `~/.agents/skills/planr/scripts/`.
