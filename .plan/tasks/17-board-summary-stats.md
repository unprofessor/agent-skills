---
id: board-summary-stats
aliases: [board-summary-stats]
kind: task
parent: board-improvements
title: Add ticket count per status to board.sh summary
status: todo
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: []
depends_on: []
---

## Goal

Append a summary section to the end of board.sh output showing ticket counts broken down by status: total, todo, in_progress, review, done, blocked. This gives the leader an instant pulse check without scanning every row.

## Context

Parent story: [[board-improvements]] under [[supplementary-tooling]]. The current board.sh lists all tickets in epics, stories, and tasks sections, plus in-flight branches, but never aggregates. A project with 50+ tickets requires manual tallying to answer “how many are done?” or “what’s in review?”.

Add the summary after the in-flight section, counting ALL tickets (epics + stories + tasks) across both trunk and branches.

## Acceptance

- [ ] `board.sh` output ends with a `## summary` section
- [ ] Summary shows counts: total, todo, in_progress, review, done, blocked
- [ ] Counts include trunk tickets (all statuses from git show) AND in-flight branches
- [ ] Zero-count statuses are shown as `0` (not omitted)
- [ ] Format: aligned columns matching the existing table style
- [ ] Performance: no additional git operations beyond what board.sh already does (reuse parsed data)
- [ ] Tests updated in `tests/run-tests.sh` to verify summary line counts

## Notes

- 2026-07-30 created
- Reuse the `fm_field` awk function already in board.sh for status extraction
- Can either parse all files twice (once for rows, once for summary) or refactor to accumulate counts during the main rendering loop
- The simpler approach: after the in-flight section, re-scan trunk files and count statuses, then add branch counts from the in-flight scan (already parsed)
