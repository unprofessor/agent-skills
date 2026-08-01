---
id: obsidian-task
aliases:
  - obsidian-task
kind: task
parent: network-firewall
title: Obsidian-reformatted ticket
status: "done"
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags:
  - obsidian
  - test
depends_on:
  - parse-foundation
  - cli-scaffolding
---

## Goal

This fixture simulates what happens when Obsidian reformats a ticket:
block-style `depends_on`, sorted keys, quoted `status: "done"`,
and `aliases:` as a block list. The typed parser must handle this
identically to the inline-style canonical task.

## Acceptance

- [ ] Block-style depends_on parses correctly
- [ ] Quoted status parses to the unquoted value

## Review

verdict: approved
