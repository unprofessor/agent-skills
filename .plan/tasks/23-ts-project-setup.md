---
id: ts-project-setup
aliases: [ts-project-setup]
kind: task
parent: parser-foundation
title: Set up TS project scaffolding (package.json, tsconfig, esbuild)
status: in_progress
assignee: null
created: 2026-08-01
updated: 2026-08-01
tags: [typescript, scaffolding, build]
depends_on: []
---

## Goal

Create `package.json`, `tsconfig.json`, and esbuild build config. Run
`npm install`. This is the minimal scaffold that [[parse-core]] and
[[git-wrappers]] both depend on — no source code beyond the config files.

## Context

Parent story: [[parser-foundation]]. The research pass chose `eemeli/yaml`
for frontmatter parsing, esbuild for bundling, vitest for testing. Pi's
node is v25.6.1 (supports `erasableSyntaxOnly`), but the shipped artifact
must be compiled JS since local-path skills don't run `npm install`.

## Acceptance

- [ ] `package.json` exists at repo root with:
  - `devDependencies`: `typescript`, `esbuild`, `vitest` (latest)
  - `dependencies`: `yaml` (eemeli/yaml)
  - `scripts.test`: `vitest run`
  - `scripts.build`: `esbuild src/cli/*.ts --bundle --platform=node --format=cjs --outdir=dist/cli --external:yaml`
- [ ] `tsconfig.json` sets `erasableSyntaxOnly: true`, `strict: true`,
  `module: nodenext`, `moduleResolution: nodenext`, `target: esnext`,
  `outDir: dist`, `rootDir: src`
- [ ] `npm install` succeeds (no lockfile conflicts)
- [ ] `npm test` runs without crashing (no tests yet, exits 0)
- [ ] `npm run build` produces at least an empty `dist/` (or succeeds
  with a warning that there's nothing to bundle yet — the real test is
  in later tasks)

## Notes

- 2026-08-01 created. No source code in this task — just config + install.
  The `--external:yaml` flag on esbuild is intentional: eemeli/yaml is the
  one runtime dep that ships with the skill; everything else is bundled.
