---
name: hermes-agent-specifics
description: "Hermes Agent mechanics for skill-promotion — install, publish, scanning, provenance."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
---

# Hermes Agent specifics (skill-promotion)

This is the completed per-harness example for `skill-promotion`. If you run a
different harness, copy `templates/agent-specifics.md` to
`references/<your-agent>.md` and fill it in — don't edit SKILL.md.

## Local skill directory

- Path: `~/.hermes/skills/<category>/<name>/` (primary, read-write). External
  skill dirs can be added (e.g. `~/.agents/skills/`).
- Loader behavior: the skill loader is initialized at **session start** — a
  newly installed/promoted skill is only visible in a **fresh session**. The
  current session will not see it.

## Install from a tap

- Tap add: `hermes skills tap add owner/repo` (stored in
  `~/.hermes/skills/.hub/taps.json`, default path `skills/`; per-tap path
  override edits that file directly)
- Install: `hermes skills install owner/repo/<name>`
- Direct install without tap: `hermes skills install owner/repo/skills/<name>`
- Category flag: `--category github` → `~/.hermes/skills/github/<name>/`
- Tap management: `hermes skills tap list|add|remove`; slash equivalents
  `/skills tap ...`
- Update lifecycle: `hermes skills check` (upstream drift), `hermes skills
  update` (reinstall changed), `hermes skills audit` (re-scan installed),
  `hermes skills reset` (bundled user-modified escape hatch)
- Slash commands in chat: `/skills browse|search|install|check|update|list`

## Bundled-skill provenance

- Bundled manifest: `grep <name> ~/.hermes/skills/.bundled_manifest`
- Default skill tree: `skills/` in the NousResearch/hermes-agent repo
  (e.g. `curl https://api.github.com/repos/NousResearch/hermes-agent/contents/skills/<category>`)
- Hub state: `~/.hermes/skills/.hub/` (lock.json, quarantine/, audit.log)
- Bundled skills are protected from being stomped: sync skips user-modified
  copies; `hermes skills reset <name>` re-baselines, `--restore` reverts.

## Security scanning

- Scanner: skills-guard (`tools/skills_guard.py::scan_skill`) — runs on
  install and on `hermes skills publish`
- Verdict semantics: `caution`/`warn` overridable with `--force`; `dangerous`
  is a hard block even with `--force`
- Trust levels: `builtin` (ships with Hermes), `official` (optional-skills/ in
  repo), `trusted` (`TRUSTED_REPOS` in `tools/skills_hub.py`: openai/skills,
  anthropics/skills, huggingface/skills, NVIDIA/skills, gstack), `community`
  (everything else incl. custom taps)
- Audit: `hermes skills audit` re-scans all hub-installed skills

## Built-in publish command

- Command: `hermes skills publish <path> --to github --repo owner/repo`
- Semantics: **forks the target repo and opens a PR** (`add-skill-<name>`
  branch, uploads to `skills/<name>/`, PR "Add skill: <name>"). Requires
  `GITHUB_TOKEN` or `gh auth login`. Fork-of-self fails — **do not use for
  your own tap**; use the plain-git worktree flow in SKILL.md.
- `--to clawhub` is parsed but not yet implemented (manual submit at clawhub.ai).

## Auth / rate limits

- Token: `GITHUB_TOKEN` in `~/.hermes/.env`, or `gh auth login`
- Rate limits: GitHub API 60 req/hr unauthenticated; 5,000/hr with token.
  Private taps require a token.

## Verification notes

- [x] Installed a skill from a tap into a fresh profile successfully
- [x] Fresh session sees the newly installed skill (loader caches at start)
- [x] Scanner verdict observed on install (skills-guard, community trust)
- [x] All fields verified — no UNVERIFIED markers
