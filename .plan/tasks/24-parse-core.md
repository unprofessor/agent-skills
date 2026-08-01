---
id: parse-core
aliases: [parse-core]
kind: task
parent: parser-foundation
title: Implement parse.ts, ticket.ts, fixtures, and vitest tests
status: in_progress
assignee: null
created: 2026-08-01
updated: 2026-08-01
tags: [parser, types, fixtures, tests]
depends_on: [ts-project-setup]
---

## Goal

Implement the full typed parsing layer (`src/parse.ts` + `src/ticket.ts`),
all test fixtures, and vitest tests. This is the core deliverable of
[[parser-foundation]] — every ported script will call `parseTicket()`.

## Context

Parent story: [[parser-foundation]]. Today's awk parsers toggle on *any*
`---` line (body thematic breaks re-enter frontmatter) and silently read
block-style YAML `depends_on` as empty (disabling gating). The typed parser
fixes both by construction. Scope: 5 scalar fields (id, kind, status,
parent, title), 1 inline-list (depends_on), 4 body-parse paths (##
Acceptance, ## Validation, last ## Review verdict, [[wiki-links]]).

## Acceptance

- [ ] `src/parse.ts` exports these pure (no-IO) functions:
  - `splitFrontmatter(blob: string): { fm: string; body: string; raw: string }`
    — reads only the FIRST `---\n…\n---` block; never re-enters on body `---`
  - `parseFrontmatter(fm: string): Record<string, unknown>` — via
    `yaml.parse`
  - `extractWikiLinks(body: string): string[]` — regex
    `\[\[([^\]|#]+)(?:#…)?(?:\|…)?\]\]`, skips fenced code blocks,
    strips `|alias`/`#heading`, deduped
  - `extractSection(body: string, name: string): string` — state machine
    on `^##`, returns lines until next `^##`, heading line excluded
  - `extractLastReviewVerdict(body: string): string | null` — last
    `## Review` block wins, `verdict:` value trimmed
- [ ] `src/ticket.ts` exports:
  - `Kind` — `const` object + union type, NOT enum
  - `Status` — union of status strings
  - `ParsedTicket` — the 5 read scalars + `depends_on: string[]` +
    `aliases: string[]` + `links: string[]` + raw body
  - `parseTicket(blob: string): ParsedTicket` — convenience composer,
    the single entry point scripts will call
- [ ] `tests/fixtures/` contains these 5 files:
  1. `canonical-task.md` — a standard task ticket
  2. `obsidian-reformatted.md` — block-style `depends_on`, sorted keys,
     quoted `status: "done"`, `aliases:` as block list
  3. `body-thematic-break.md` — a body `---` followed by a line that
     looks like frontmatter (proves no re-entry)
  4. `multiple-reviews.md` — multiple `## Review` blocks (proves
     last-wins)
  5. `wiki-links-edge-cases.md` — `[[a|label]]`, `[[b#heading]]`,
     `[[c]]` inside a fenced code block (proves code-fence skip)
- [ ] `tests/parse.test.ts` (vitest) asserts:
  - Block-style `depends_on` parses to same array as inline
  - Quoted `status: "done"` parses to `done`
  - Body `---` does NOT re-enter frontmatter
  - Wiki-link in a code fence is NOT extracted
  - Last review verdict wins and is trimmed
- [ ] `npm test` passes all tests
- [ ] `npm run build` produces `dist/` artifacts (parser is bundlable)

## Notes

- 2026-08-01 created. Depends on [[ts-project-setup]] for the build
  infrastructure. Do NOT touch `scripts/*.sh` — this is parser only.
