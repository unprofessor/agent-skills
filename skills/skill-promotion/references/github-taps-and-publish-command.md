# GitHub taps & the publish command — source-level detail

Gathered from the hermes-agent repo (main branch, Aug 2026). Where docs were thin, the
authoritative source is code — docs list commands; code defines semantics.

## Where things live in the hermes-agent repo

| File | Role |
|---|---|
| `hermes_cli/subcommands/skills.py` | Parser: `publish` args = `skill_path`, `--to {github,clawhub}` (default github), `--repo` (default ""). |
| `hermes_cli/skills_hub.py::do_publish` | Pre-publish: resolves path (relative → `SKILLS_DIR/path`), parses frontmatter, **requires `description`** (no name check beyond that), runs `scan_skill(path, source="self")`, **refuses `dangerous` verdicts**, requires GitHub auth (`GITHUB_TOKEN` or `gh auth login`). |
| `hermes_cli/skills_hub.py::_github_publish` | Mechanics: fork target repo → get default branch → base tree SHA → branch `add-skill-<name>` → upload every file in skill dir via contents API to `skills/<name>/<rel>` → open PR `"Add skill: <name>"` with head `forkowner:add-skill-<name>`. |
| `tools/skills_hub.py` | Backend: tap manager, lock file, scanner. `TRUSTED_REPOS` list controls which repos get `trusted` (vs `community`) trust. |
| `tools/skills_guard.py` | `scan_skill()` — the scanner publish runs. Verdicts: caution/warn (overridable with `--force`) vs `dangerous` (hard block, even with `--force`). |

## Tap rules (from website/docs/user-guide/features/skills.md)

- Tap repo layout: `skills/<name>/SKILL.md` required, plus optional `references/`,
  `templates/`, `scripts/`, `assets/` copied alongside at install.
- Discovery: list every subdir of the tap path, probe each for `SKILL.md`. Only
  referenced support files are copied; unreferenced repo files are not.
- Dirs starting with `.` or `_` are ignored.
- Default tap path is `skills/`; override per-tap in `~/.hermes/skills/.hub/taps.json`:
  ```json
  { "taps": [ { "repo": "my-org/platform-docs", "path": "internal/skills/" } ] }
  ```
- Optional `skills.sh.json` at repo root (schema: https://skills.sh/schemas/skills.sh.schema.json)
  with `groupings` (title + skill-name list) → Skills Hub category labels.
- Tap management: `hermes skills tap list|add|remove`; slash equivalents `/skills tap ...`.
- Installed-tap provenance: hub tracks source identifier + content hash per skill;
  `hermes skills check` / `update` detect upstream drift.
- Rate limits: hub ops use GitHub API (60 req/hr unauthenticated; set `GITHUB_TOKEN`
  in `.env` for 5,000/hr). Private taps require a token.
- Install name resolution (URL installs): frontmatter `name` → URL slug → interactive
  prompt → `--name` flag (non-interactive surfaces error and demand `--name`).

## Trust levels

| Level | Source | Policy |
|---|---|---|
| `builtin` | Ships with Hermes | Always trusted |
| `official` | `optional-skills/` in repo | Built-in trust, no warning panel |
| `trusted` | `TRUSTED_REPOS` (openai/skills, anthropics/skills, huggingface/skills, NVIDIA/skills, gstack) | More permissive |
| `community` | Everything else, incl. custom taps | `--force` overrides non-dangerous; `dangerous` stays blocked |

## Hybrid repos make valid taps

A repo that is *also* a software project (src/, scripts/, tests/, package.json)
is a valid tap with zero restructuring, as long as skills live under the
configured tap path (default `skills/`). Tap discovery only probes subdirs of
that path, so unrelated tooling is ignored. A hybrid layout like
`skills/<name>/` next to project code works out of the box.

## Provenance check example

Before promoting a skill, verify it is NOT bundled with Hermes (which would
create a drifting duplicate):

```bash
# 1. Is it in the bundled manifest?
grep "<skill-name>" ~/.hermes/skills/.bundled_manifest

# 2. Is it in the hermes-agent repo's skills tree?
#    (list skills/github/ for a github-category skill, etc.)
curl -fsSL https://api.github.com/repos/NousResearch/hermes-agent/contents/skills/<category>
```

Not in either → user-local, safe to promote.
