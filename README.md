# agent-skills

A GitHub **skills tap** for AI agents &mdash; a small collection of reusable,
agent-consumable `SKILL.md` files that any markdown-reading agent harness can
install (Hermes Agent, Claude Code, OpenCode, Pi, and others).

This repo is a GitHub **skills tap**: a collection of `SKILL.md` files for
AI agents, each in its own directory under `skills/`.

## What's inside

| Skill | What it does |
|---|---|
| [`planr`](skills/planr/SKILL.md) | Trunk-based backlog for multi-agent work: epics/stories/tasks as one file per ticket, worktree-per-worker, independent reviewer before merge. |
| [`tend-pr`](skills/tend-pr/SKILL.md) | Tend an open PR: poll reviewer comments on a schedule, dedupe, draft gated replies. |
| [`skill-promotion`](skills/skill-promotion/SKILL.md) | Promote local skills into this tap (and sync edits back): the meta-skill for maintaining this repo. |

Each skill ships with its own `SKILL.md` (the instructions the agent loads)
plus any `references/`, `templates/`, `scripts/`, and `assets/` it needs.

## Installing skills

With Hermes Agent:

```bash
hermes skills tap add unprofessor/agent-skills   # once per machine
hermes skills install unprofessor/agent-skills/planr
hermes skills install unprofessor/agent-skills/tend-pr
hermes skills install unprofessor/agent-skills/skill-promotion
```

Or install one skill directly without adding the tap:

```bash
hermes skills install unprofessor/agent-skills/skills/tend-pr
```

Other harnesses: if your agent reads `SKILL.md` files (the
[agentskills.io](https://agentskills.io/specification) open standard &mdash; Claude
Code, OpenCode, Pi, etc.), point it at this repo's `skills/` directory. The
`skill-promotion` skill documents per-harness install mechanics in
`skills/skill-promotion/references/`.

> New taps default to `community` trust, and every skill is security-scanned
> on install. A `dangerous` scan verdict blocks installation regardless of
> `--force`.

## Repository layout

```
skills/
|-- planr/               # one directory per skill
|   |-- SKILL.md
|   \-- ...
|-- tend-pr/
|   \-- SKILL.md
\-- skill-promotion/
    |-- SKILL.md
    |-- references/
    |-- templates/
    \-- scripts/
```

Tap rules:

- **Flat layout** &mdash; every directory directly under `skills/` is one skill;
  the directory name is the install slug. Category directories are NOT used
  in the repo (categories are applied at install time, e.g.
  `hermes skills install ... --category github`).
- Directories starting with `.` or `_` are ignored.
- `skills.sh.json` at the repo root may add category groupings for the
  [Skills Hub](https://hermes-agent.nousresearch.com/docs) UI (not yet present).

## Contributing a skill

See [`skills/skill-promotion/SKILL.md`](skills/skill-promotion/SKILL.md) &mdash;
the canonical workflow. The short version:

1. **Gate** &mdash; the skill must be generalizable (no environment-specific paths,
   hostnames, or personal credentials) and have complete frontmatter
   (`name`, `description`, `version`, `author`, `license`, `tags`).
2. **Provenance check** &mdash; confirm it's not a bundled Hermes skill
   (`grep <name> ~/.hermes/skills/.bundled_manifest` and compare against the
   hermes-agent repo's `skills/` tree).
3. **Worktree + copy flat** &mdash; `git worktree add <path> -b promote/<skill>`
   off `main`, copy into `skills/<skill>/` (strip any category level).
4. **Validate** &mdash; `python3 skills/skill-promotion/scripts/validate_skill.py skills/<skill>`.
5. **Canonical-source marker** &mdash; every promoted skill carries a
   `## Canonical source` section in its body pointing at this repo, so agents
   edit the repo copy rather than installed snapshots.
6. **PR + merge** &mdash; follow this repo's contribution policy (merge commits,
   commit identity per the project convention).

## Repository policy

- **Merge commits only** &mdash; no rebase/squash; history is preserved so
  regressions and merge conflicts stay debuggable.
- **Main stays on main** &mdash; every branch gets its own git worktree.

## License

MIT (skills carry `license: MIT` in their frontmatter).
