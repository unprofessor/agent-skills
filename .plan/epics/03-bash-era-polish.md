---
id: bash-era-polish
aliases: [bash-era-polish]
kind: epic
title: Polish the bash scripts before the TypeScript port
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: []
---

## Goal

Polish the current bash-based planr scripts with quick, high-value improvements — board summary stats, utility scripts, and documentation — before the TypeScript port consumes all bash-era attention.

## Scope

- **Board improvements**: summary stats (count per status) and a roll-up progress command for story/epic completion
- **Utility scripts**: backlinks.sh for wiki-link discovery, a pre-commit hook template for lint.sh
- **Documentation**: optimize SKILL.md frontmatter for triggering, add a troubleshooting section

## Out of scope

- Changes to the ticket format, process, or role model (those are stable)
- The TypeScript port itself (tracked in [[port-scripts-to-typescript]])
- Retro-hardening features (verify hook, resume, waiver — tracked in [[retro-hardening]])

## Notes

- 2026-07-30 created from the skill-creator analysis of planr. These are the highest-impact improvements that can be done on the bash scripts immediately, without waiting for the TS port.
- None of these stories depend on the port epic, so they can be claimed right away.
