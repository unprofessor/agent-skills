---
id: troubleshooting-guide
aliases: [troubleshooting-guide]
kind: task
parent: doc-improvements
title: Add troubleshooting section to SKILL.md
status: in_progress
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: []
depends_on: []
---

## Goal

Add a “Troubleshooting” section to SKILL.md covering common issues that arise in multi-agent planr workflows, with concrete resolution steps.

## Context

Parent story: [[doc-improvements]] under [[supplementary-tooling]]. The existing documentation covers the happy path (plan → create → claim → implement → review → merge) thoroughly, but has no section for what to do when things go wrong: merge conflicts, stale worktrees, interrupted workers, reviewer can’t find the worktree, etc. These are documented across scripts and edge cases in PROCESS.md but not gathered in one troubleshooting reference.

## Acceptance

- [ ] Add a `## Troubleshooting` section to SKILL.md with subsections for each common issue
- [ ] Covers at minimum:
  - **Merge conflict during `merge-task.sh`**: what the error looks like, how the worker rebases, the exact commands to run
  - **Stale worktree after branch cleanup**: `git worktree prune` and manual removal
  - **Worker interrupted mid-task**: how to check task file `## Notes`, resume protocol, what the leader should do
  - **Reviewer cannot find worktree**: `scripts/review.sh` prints the path; fallback `git worktree list`
  - **Dependency cycle detected**: how to read the cycle output from lint.sh, how to break it
  - **Cross-platform sed issues**: macOS users need `brew install gnu-sed` or the workaround command
- [ ] Each entry has: symptom, cause, resolution steps
- [ ] Keep entries brief and actionable (code snippets where helpful)

## Notes

- 2026-07-30 created
- The `## Troubleshooting` section should go near the end of SKILL.md, before `## Extracting this skill`
- Draw from:
  - PROCESS.md edge cases section
  - merge-task.sh’s conflict guidance comments
  - claim.sh’s dependency refusal message
  - review.sh’s worktree discovery fallback
- Use imperative mood in resolution steps (“Run `git worktree prune`”, not “the user should run...”)
