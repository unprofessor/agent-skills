---
id: utility-scripts
aliases: [utility-scripts]
kind: story
parent: bash-era-polish
title: New helper scripts for the bash era
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: []
depends_on: []
---

## Goal

Add two new utility scripts: `backlinks.sh` for discovering which tickets wiki-link to a given slug, and a `pre-commit` hook template that runs `lint.sh` on staged `.plan/` changes to catch dangling refs before they reach trunk.

## Context

Parent epic: [[bash-era-polish]]. The SKILL.md documents `grep -rn '\[\[slug\]\' .plan/` as the backlinks discovery method — a dedicated script is one command with proper .plan/ path resolution. The pre-commit hook is noted as out-of-scope in [[port-scripts-to-typescript]] but is a valuable guardrail that should exist in the bash era.

## Notes

- 2026-07-30 created
- Tasks: `backlinks-script` (backlinks.sh), `precommit-hook` (pre-commit hook template)
