---
name: <your-agent>
description: "Agent-specific mechanics for <your-agent> — used by skill-promotion."
version: 1.0.0
author: <your name or org>
license: MIT
platforms: [linux, macos, windows]
---

# <Your-Agent> specifics (skill-promotion)

This file is the **per-harness extension mechanism** for the `skill-promotion`
skill. `SKILL.md` is deliberately harness-agnostic; everything below resolves
the `<placeholder>`s it references for YOUR agent. See `hermes.md` in this
directory for a completed example.

**How to add your harness:** copy this file to `references/<your-agent>.md`,
fill in every field, and commit it back to the tap so other agents of your
harness can use it. Mark fields you could not verify as `UNVERIFIED` — an
agent of another harness must not guess on your behalf.

## Local skill directory

- Path: `<e.g. ~/.hermes/skills/<category>/<name>/ — where YOUR harness keeps
  installed/editable skills>`
- Loader behavior: `<does the harness load skills from this dir at session
  start? Is a fresh session required to see new skills?>`

## Install from a tap

- Tap add: `<command, e.g. hermes skills tap add owner/repo>`
- Install: `<command, e.g. hermes skills install owner/repo/<name>>`
- Direct install without tap: `<command, if supported>`
- Category flag: `<flag to place under a local category, e.g. --category github>`

## Bundled-skill provenance

- Bundled manifest: `<path/command to check whether a skill ships with the
  harness, e.g. grep <name> ~/.hermes/skills/.bundled_manifest>`
- Default skill tree: `<where the harness's bundled skills live upstream>`

## Security scanning

- Scanner: `<name/command that scans skills on install>`
- Verdict semantics: `<caution/warn overridable? dangerous blocks? --force?>`
- Trust levels: `<builtin/official/trusted/community or equivalent>`

## Built-in publish command (if any)

- Command: `<e.g. hermes skills publish <path> --to github --repo owner/repo>`
- Semantics: `<does it fork+PR (upstream only) or write directly?>`

## Auth / rate limits

- Token: `<env var / auth mechanism needed for tap operations>`
- Rate limits: `<e.g. 60 req/hr unauthenticated GitHub API>`

## Verification notes

- [ ] Installed a skill from a tap into a fresh profile successfully
- [ ] Fresh session sees the newly installed skill
- [ ] Scanner verdict observed on install
- [ ] Any UNVERIFIED fields flagged as such
