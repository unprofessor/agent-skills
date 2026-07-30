---
id: backlinks-script
aliases: [backlinks-script]
kind: task
parent: utility-scripts
title: Add backlinks.sh to find wiki-link references to a slug
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: []
depends_on: []
---

## Goal

Add a `scripts/backlinks.sh` utility that finds all `.plan/` files wiki-linking to a given slug. Currently the skill documents `grep -rn '\[\[slug\]' .plan/` as the manual method — this wraps that in a proper script with `PLANR_DIR` support.

## Context

Parent story: [[utility-scripts]] under [[bash-era-polish]]. The SKILL.md says “Backlinks are derived, never stored — same philosophy as roll-up: `grep -rn '\[\[http-connect-proxy' .plan/`”. A dedicated script is a one-command convenience that properly resolves `.plan/` path from env vars and filters out the false positives (e.g., frontmatter `aliases` fields which also contain the slug).

Existing patterns to follow: `review.sh` for env var handling (`PLANR_DIR`, `PLANR_TRUNK`), `lint.sh` for wiki-link extraction regex (`grep -oE '\[\[[^]]+\]\]'` and stripping `|alias`/`#heading` suffixes).

## Acceptance

- [ ] `scripts/backlinks.sh <slug>` prints every `.plan/` file whose body contains `[[<slug>]]` or `[[<slug>|...]]` or `[[<slug>#...]]`, one per line, with file path
- [ ] Does NOT match frontmatter (e.g., `aliases: [slug]`, `parent: slug`, `depends_on: [slug]`) — only body markdown
- [ ] `scripts/backlinks.sh <slug> -v` also prints the matching line for context
- [ ] Honors `PLANR_DIR` env var (default `.plan`)
- [ ] Exits 0 if any backlinks found, 1 if none
- [ ] Included in `tests/run-tests.sh` with a fixture test
- [ ] Documented in SKILL.md scripts table

## Notes

- 2026-07-30 created
- Build on the existing `grep -oE` pattern from `lint.sh`’s wiki-link extraction
- Use `grep -rn` with `--include='*.md'` to stay fast on large plans
- To exclude frontmatter, grep for the link pattern but skip lines before the first `## ` heading (body content), or after the `---` closing frontmatter
