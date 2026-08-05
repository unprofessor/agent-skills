# Tap model — source-level detail

The tap concept is a cross-harness convention built on the open SKILL.md
standard (agentskills.io / skills.sh). Any agent that reads markdown
instructions can consume a tap. This file covers the model itself;
harness-specific mechanics live in the per-agent reference files
(`references/hermes.md`, `references/<your-agent>.md`).

## Where the model is documented

- SKILL.md format: [agentskills.io](https://agentskills.io/specification) open
  standard; `name` + `description` frontmatter required, ≤1024-char
  description, file ≤100k chars.
- skills.sh schema: https://skills.sh/schemas/skills.sh.schema.json
- Ecosystem taps: openai/skills, anthropics/skills, huggingface/skills,
  NVIDIA/skills, garrytan/gstack, vercel-labs/agent-skills — all monorepos.

## Tap repo rules

- Layout: `skills/<name>/SKILL.md` required, plus optional `references/`,
  `templates/`, `scripts/`, `assets/` copied alongside at install.
- Discovery: list every subdir of the tap path, probe each for `SKILL.md`.
  Only referenced support files are copied; unreferenced repo files are not.
- Dirs starting with `.` or `_` are ignored.
- Default tap path is `skills/`; per-tap override in the harness's taps
  registry (Hermes: `~/.hermes/skills/.hub/taps.json`).
- Optional `skills.sh.json` at repo root with `groupings` (title +
  skill-name list) → category labels in the Skills Hub UI.
- Install name resolution (URL installs): frontmatter `name` → URL slug →
  interactive prompt → `--name` flag.
- Hybrid repos (a tap that is *also* a software project) are valid with zero
  restructuring — discovery only probes subdirs of the tap path, so unrelated
  tooling is ignored.

## Trust & scanning model

| Level | Source | Policy |
|---|---|---|
| `builtin` | Ships with the harness | Always trusted |
| `official` | Official optional skills | Built-in trust, no warning |
| `trusted` | Named trusted repos | More permissive policy |
| `community` | Everything else, incl. custom taps | Non-dangerous overridable; `dangerous` stays blocked |

The scanner itself (name, verdict semantics, `--force` behavior) is
harness-specific — see your agent's reference file.

## GitHub API constraints (shared by all harnesses)

- Hub operations use the GitHub API: 60 req/hr unauthenticated, 5,000/hr with
  a token (`GITHUB_TOKEN`).
- Private taps require a token.
- Repo renames need `Administration: write` on a fine-grained PAT (or classic
  PAT with `repo` scope); the repo-level admin flag alone is not enough.
- Fork-of-self fails — any fork-and-PR publish flow cannot target your own repo.
