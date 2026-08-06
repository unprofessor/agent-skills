# Planr

Trunk-based planning and backlog management for multi-agent development.

Planr turns a git repo into a lightweight ticket board with **no database, no
server, and no claim locks**. Tickets are markdown files under `.plan/`; the
git trunk is the board; a worktree branch *is* the claim on a task. The
`planr` binary serializes prefix allocation and trunk mutation with an
in-process `flock` (an implementation detail, not something agents manage).
Three agent roles — a **leader**, **workers**, and **reviewers** — cooperate
so that any number of workers can run in parallel without ever editing the
same file, and a task is only ever marked `done` after an independent
reviewer re-runs its acceptance checks.

> This skill is designed for **agentic** development: one leader agent
> coordinates with you while many worker and reviewer agents execute in
> parallel. It also works fine for a single human driving it by hand.

## The three roles

All three role names are *agent nouns* — the doer of the action.

| Role | Context | Owns | Does not |
| --- | --- | --- | --- |
| **Leader** | foreground, with you | the backlog: creates & edits tickets on trunk, sets `depends_on`, dispatches workers & reviewers, closes approved tasks/stories/epics | implement or review tasks |
| **Worker** | a worktree, one task | implements its task, self-validates against `## Acceptance`, sets `status: review` | create tickets, set `done` |
| **Reviewer** | fresh context, one task | re-runs the acceptance checks itself, writes `## Review` with a `verdict` | edit code, set `done` |

`review` → `done` is **never** on the honor system: `planr close task` requires
both `status: review` **and** an approved `## Review` verdict before it merges.

## How it works

- **One file per ticket** under `.plan/{epics,stories,tasks}/`, named
  `<NN>-<slug>.md` (a 2-digit sort hint + a kebab-case slug that is the
  ticket's identity).
- **Downward is stored in the child.** A task's frontmatter names its `parent`
  story and its `depends_on` prerequisites; a story names its `parent` epic.
  No agent ever edits a parent to record child progress.
- **Roll-up is derived, never stored.** A story's progress is computed by
  scanning its child tasks on trunk at read time — there is no central,
  mutable index that gets rewritten on every change.
- **One dependency graph.** `depends_on` can point at *any* ticket in the
  backlog (cross-story, cross-epic), not just siblings. `planr claim` refuses
  to dispatch a task whose deps aren't all `done`.
- **Obsidian-compatible.** Tickets are frontmatter + `[[wiki-links]]`, so
  `.plan/` opens directly as an Obsidian vault (graph view, backlinks,
  properties) for a free read-only UI. Links are soft sugar, never state — no
  tool parses them; gating lives only in `depends_on`, hierarchy only in
  `parent`.

## Quick start

From the repo where you want to track work (it must already be a git repo with
a trunk branch):

```bash
# 1. See the board (empty until you create tickets).
planr board

# 2. Create an epic, a story under it, and a task under that.
planr new epic   v1  "v1 milestone"
planr new story  net "Networking"          v1
planr new task   dns "DNS resolution"      net

# 3. Commit the backlog so workers can branch from it.
git add .plan && git commit -m "seed plan"

# 4. Claim the task (creates a worktree branch).
planr claim dns

# 5. Implement in the worktree, then flip to review.
# 6. Review with planr review dns; close with planr close task dns.
# 7. Close the story/epic after all children done:
#    planr close story net
#    planr close epic   v1
```

See [SKILL.md](SKILL.md) for the full process.

## Commands

| Command | Who | Purpose |
| --- | --- | --- |
| `planr board` | all | Read-only board: backlog from trunk + in-flight/review-ready from `plan/*` branches |
| `planr lint [ref]` | leader | Structural checks: dangling parents/deps, duplicate slugs, cycles (errors); unresolved wiki-links (warnings) |
| `planr new` | leader | Scaffold a ticket file with next sort-hint + slug |
| `planr claim` | leader | Create a worktree branch; flips to `in_progress` |
| `planr review` | leader/reviewer | Brief a reviewer: branch, worktree, acceptance, diff |
| `planr close task` | leader | Merge approved task; flips done on branch before merge |
| `planr close story` | leader | Gate children done → flip done on trunk |
| `planr close epic` | leader | Gate stories done → flip done on trunk |

## Prerequisites

- **Rust toolchain** (to build from source) or a **prebuilt binary**.
- **git** (any modern version).
- **No `flock` binary required** — the Rust binary uses in-process locking.

Install the binary:

```bash
cargo install --git https://github.com/unprofessor/planr-cli.git
# or download from https://github.com/unprofessor/planr-cli/releases
```

## Environment

- `PLANR_TRUNK` — default trunk branch (default: `main`)
- `PLANR_DIR` — plan directory (default: `.plan`)

## Repository layout (this skill)

```
SKILL.md              # Main skill definition (agent-facing)
README.md             # This file
references/
  PROCESS.md          # Full process documentation
  TICKET-FORMAT.md    # Ticket format reference
scripts/
  board.sh            # Thin shims → planr board, etc.
  claim.sh
  lint.sh
  merge-task.sh
  new-ticket.sh
  review.sh
templates/            # Starter ticket files (epic.md, story.md, task.md)
```
