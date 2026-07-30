---
id: board-improvements
aliases: [board-improvements]
kind: story
parent: bash-era-polish
title: Enhance board.sh with summary stats and progress tracking
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: []
depends_on: []
---

## Goal

Enhance the board.sh output with summary statistics (ticket counts per status) and add a roll-up progress command so the tech lead can see story/epic completion at a glance without manual counting.

## Context

Parent epic: [[bash-era-polish]]. The current board.sh lists all tickets but gives no aggregate view — a tech leading a project with 40+ tickets has to mentally tally progress. Stories and epics have no %-complete indicator. The worktree branch section also doesn't group in-flight tasks by their parent story.

These are pure enhancements to the existing bash scripts. They live in the bash era and will be ported to TS along with the rest of the scripts.

## Notes

- 2026-07-30 created
- Tasks: `board-summary-stats` (summary counts), `roll-up-progress` (progress computation)
