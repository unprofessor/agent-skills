---
name: skill-promotion
description: "Use when promoting or syncing a skill with a public GitHub tap."
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [skills, publishing, github, taps, hermes-agent]
    related_skills: [hermes-agent-skill-authoring, github-pr-workflow]
---

# Skill Promotion (user-local → public tap)

## Canonical source

This skill is published to the `unprofessor/agent-skills` tap (repo:
[`skills/skill-promotion`](https://github.com/unprofessor/agent-skills/tree/main/skills%2Fskill-promotion)).
The repo copy is authoritative.

- **Iterate locally, converge in the repo.** Editing the installed copy is
  fine for rapid iteration (the harness loads it), but the repo copy is
  authoritative: sync back when the change stabilizes, then refresh installed
  copies. Never leave the two divergent at session end.
- **Policy/behavior changes go through the repo PR flow** — that's the review
  gate. Mechanics (scripts, wording) may iterate locally first.
- The tap may host other skills; keep changes scoped to this skill's dir.

Publish a skill that lives in `~/.hermes/skills/<category>/<name>/` into a
public GitHub tap repo so `hermes skills install <owner>/<repo>/<name>` works
for anyone. Target repo: the user's tap (e.g. `owner/agent-skills`), which
must be laid out as `skills/<name>/SKILL.md`.

## When to Use

- User asks to "publish", "promote", or "share" a skill publicly
- Moving a user-local skill into a tap repo, keeping it installable
- Adding a skill to an existing tap repo
- **Syncing local edits of an already-promoted skill back to the repo** (the
  local copy was edited in place; the repo is stale). Check drift first:
  `diff <(git show origin/main:skills/<name>/SKILL.md) ~/.hermes/skills/<cat>/<name>/SKILL.md`

Don't use for: contributing to the hermes-agent bundled repo (`skills/` inside
NousResearch/hermes-agent — that's hermes-agent-skill-authoring territory) or
publishing to someone else's repo.

## Canonical-source marker (required on every promoted skill)

Once a skill is in the tap, **the repo copy is the source of truth**. Agents
must know this BEFORE they edit — so the marker lives inside the skill itself
(agents load the skill before using/editing it). Add to the repo copy, near
the top of the body:

```markdown
## Canonical source

This skill is published to the `<owner>/<repo>` tap (repo:
[`skills/<name>`](https://github.com/<owner>/<repo>/tree/main/skills%2F<name>)).
The repo copy is authoritative.

- **Iterate locally, converge in the repo.** Editing the installed copy is
  fine for rapid iteration (the harness loads it), but the repo copy is
  authoritative: sync back when the change stabilizes, then refresh installed
  copies. Never leave the two divergent at session end.
- **Policy/behavior changes go through the repo PR flow** — that's the review
  gate. Mechanics (scripts, wording) may iterate locally first.
- The tap may host other skills; keep changes scoped to this skill's dir.
```

Also keep the local and repo copies in lockstep after any sync (reinstall the
repo version locally so the next agent doesn't diff-drift again).

## Edit decision (which copy first?)

An agent editing a promoted skill asks: **"does this need to be live in the
harness to be tested, or reviewed before it's live?"**

- **Local-first (iterate, then sync)** — the change must be testable in the
  harness (the loader reads the installed copy), or it's exploratory and may
  be reverted. Edit in place, test, then sync-back when stable.
- **Repo-first (PR, then reinstall)** — the change is policy/behavior-semantic
  (a skill editing its own instructions should pass the human review gate),
  already well-specified, or contended across multiple agent sessions (the PR
  flow serializes writes; local edits are last-writer-wins on shared state).

Both paths converge on the invariant: **local == origin/main for every
promoted skill at session end**, or the divergence is explicitly declared.

## Hard Facts (verified against tools/skills_hub.py + docs)

- Tap repo layout is **strictly flat**: `skills/<name>/SKILL.md`. Discovery
  lists ONE level of `skills/` and treats every directory as a skill candidate
  (probes for SKILL.md). It never recurses.
- **Never nest category dirs** in the repo (`skills/github/<name>/`): `github/`
  gets probed, fails, is skipped; `<name>/` is never seen. Discovery silently
  breaks.
- Directory name = install slug. Dirs starting with `.` or `_` are ignored.
- Categories are **install-side only**: `hermes skills install <id> --category github`
  → `~/.hermes/skills/github/<name>/`. The repo carries no category structure.
- Category *labels* in the repo come from frontmatter `metadata.hermes.tags`,
  or from a `skills.sh.json` at repo root (skills.sh schema `groupings`) → real
  category pills in the Skills Hub UI. Add the JSON only once there are ~5+ skills.
- `hermes skills publish <path> --to github --repo owner/repo` exists but it
  FORKS the target repo and opens a PR — for upstream/third-party repos, NOT
  your own tap. For own repos use plain git.
- Install scan: skills-guard runs automatically at install time. New taps get
  `community` trust; `dangerous` verdicts block install regardless of --force.

## Workflow (promote: new skill)

1. **Gate check** — the skill must be generalizable (no environment-specific
   paths, hostnames, or personal creds), and frontmatter must have `name`,
   `description`, `version`, `author`, `license`, `metadata.hermes.tags`.
   Completion: all gates pass, or user explicitly overrides.
2. **Provenance check** — confirm the skill isn't bundled (re-publishing a
   bundled skill creates a drifting duplicate):
   `grep <name> ~/.hermes/skills/.bundled_manifest` and compare against the
   hermes-agent repo's `skills/` listing. Completion: not in either.
3. **Worktree** — main stays on main. Clone fresh if needed, else
   `git worktree add <path> -b promote/<skill>` off origin/main.
   Completion: worktree exists, branch based on main.
4. **Copy flat** — strip the category level from the source path:
   `cp -r ~/.hermes/skills/<category>/<skill>/ skills/<skill>/` (plus any
   references/, templates/, scripts/, assets/ inside it). Completion: dest has
   `skills/<skill>/SKILL.md` and no parent category dir.
5. **Validate** — (a) run `scripts/validate_skill.py <skill-dir>`;
   (b) confirm flat: `ls skills/` shows only one dir per skill; (c) no
   dot/underscore-prefixed skill dirs. Completion: all three pass.
6. **Add the Canonical-source marker** if the skill lacks it (see above).
   Completion: marker present in the repo copy.
7. **Commit + push** — merge commits only, never rebase/squash. Follow the
   repo owner's commit-identity convention (author + co-author trailer if
   that's the established pattern). Push branch, open PR to main (own repo:
   normal PR flow is fine).
8. **Verify** — `hermes skills tap add <owner>/<repo>` (or direct
   `hermes skills install <owner>/<repo>/<skill>`), install to a scratch
   profile, confirm scan passes and the skill loads in a FRESH session (the
   current session's loader is cached and won't see it).

## Sync-back mode (local edits → repo)

Use when a promoted skill's **local copy was edited in place** and the repo
is stale (diff first — see When to Use). Same mechanics as promote, but:

1. **Diff first** — confirm real changes: `diff <(git show origin/main:skills/<name>/SKILL.md) <local>` and same for scripts/. If only the Canonical-source marker is missing (not yet added), that's still worth a PR.
2. **Worktree** — `git worktree add ... -b sync/<skill>` off main.
3. **Copy local → repo** — `cp -r ~/.hermes/skills/<cat>/<skill>/ skills/<skill>/` (flat; overwrites repo copy with local, INCLUDING any local-only edits).
4. **Verify the Canonical-source marker survived** — if the local copy lacks it, add it now (it's part of the repo copy's contract). Also verify local SKILL.md and scripts/ don't reference local-only paths.
5. **Validate + commit + PR + merge** — same as promote steps 5-7.
6. **Reinstall repo version locally** — after merge, `hermes skills install <owner>/<repo>/<skill>` (or update) so the local copy matches the repo again and the next agent doesn't diff-drift. Completion: local == origin/main for that skill.

## Common Pitfalls

1. **Nesting categories in the tap** — breaks discovery silently (see Hard
   Facts). The source `~/.hermes/skills/github/<name>/` becomes
   `skills/<name>/` in the repo, NOT `skills/github/<name>/`.
2. **Using `hermes skills publish` on own repos** — it forks the target; you
   can't fork your own repo. Plain git worktree flow instead.
3. **Forgetting local category on install** — repo is flat, so reinstalling
   lands flat unless the user passes `--category` (matching their old local
   bucket).
4. **Expecting the live session to see the new skill** — skill loader is
   initialized at session start. Fresh session required.
5. **Copying stray files** — copy only the skill dir (SKILL.md + its
   references/templates/scripts/assets). Unreferenced repo files aren't pulled
   at install time anyway.
6. **Environment-specific skills** — host paths, hostnames, creds = no-op
   prose for other users. Keep those local; promote only generic skills.
7. **Editing a promoted skill in place (local only)** — the repo copy is the
   source of truth; a local-only edit silently drifts. This is exactly what
   the Canonical-source marker prevents: agents read the skill before editing
   it, see the marker, and route the edit to the repo (or sync back). If you
   find a promoted skill whose local copy differs from origin/main and it has
   no marker, add the marker during the sync-back.
8. **Skipping the provenance check** — promoting a bundled skill creates a
   drifting duplicate that fights `hermes skills update`. Always check
   `.bundled_manifest` + the hermes-agent repo tree first.

## Verification Checklist

- [ ] `skills/<skill>/SKILL.md` exists; layout is flat (no category dirs)
- [ ] Canonical-source marker present in the repo copy of the skill body
- [ ] Frontmatter: name, description (≤1024), version, author, license, tags
- [ ] Provenance confirmed (not bundled / hub-installed)
- [ ] Worktree branch based on main; merge commit used, not rebase/squash
- [ ] Commit identity follows the repo owner's convention
- [ ] Local copy == origin/main for the skill after sync (no residual drift)
- [ ] `hermes skills install <owner>/<repo>/<skill>` succeeds in fresh profile
- [ ] Skill loads in a fresh session (not the creating session)
