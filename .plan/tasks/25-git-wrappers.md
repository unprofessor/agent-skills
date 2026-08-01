---
id: git-wrappers
aliases: [git-wrappers]
kind: task
parent: cli-scaffolding
title: Implement typed git wrappers (src/git.ts)
status: todo
assignee: null
created: 2026-08-01
updated: 2026-08-01
tags: [git, wrappers, typescript]
depends_on: [ts-project-setup]
---

## Goal

Implement `src/git.ts` — typed wrapper functions around `execFileSync('git',
…)`. No simple-git, exact current behavior, worktree support intact.

## Context

Parent story: [[cli-scaffolding]]. Every ported script that touches git
(board, claim, merge-task, review) calls these instead of raw
`execFileSync`. The wrappers add types, error handling, and a single place
to change git invocation behaviour later.

## Acceptance

- [ ] `src/git.ts` exports these typed functions, all via
  `execFileSync('git', …)`:
  - `lsTreeMd(ref: string, dir: string): string[]` — `git ls-tree -r
    --name-only <ref> -- <dir>` filtered to `*.md`
  - `showRef(ref: string, path: string): string` — `git show
    <ref>:<path>`
  - `worktreeAdd(path: string, branch: string, ref?: string): void`
  - `worktreeRemove(path: string, force?: boolean): void`
  - `branchDelete(branch: string, force?: boolean): void`
  - `mergeNoFf(branch: string): void` — `git merge --no-ff <branch>`
  - `checkout(branch: string): void`
  - `commit(message: string, files?: string[]): void`
  - `diffRefs(ref1: string, ref2: string): string` — `git diff
    <ref1>..<ref2>`
  - `branchList(pattern?: string): string[]` — `git branch --list`
  - `worktreeList(): string[]` — `git worktree list --porcelain`
  - `revParseVerify(ref: string): string` — `git rev-parse --verify
    <ref>`
- [ ] All functions throw on non-zero exit (default `execFileSync`
  behavior), with the git stderr message preserved
- [ ] `src/git.ts` imports nothing except `execFileSync` from
  `node:child_process`
- [ ] `npm run build` succeeds with `src/git.ts` included (the esbuild
  config may need a minor update — see [[cli-shims]])

## Notes

- 2026-08-01 created. Depends on [[ts-project-setup]] for the build
  infrastructure and `src/` directory structure. May be developed in
  parallel with [[parse-core]] since they touch different files.
