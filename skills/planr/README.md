# Planr

Trunk-based planning and backlog management for multi-agent development.

Planr turns a git repo into a lightweight ticket board with **no database, no
server, and no claim locks**. Tickets are markdown files under `.plan/`; the
git trunk is the board; a worktree branch *is* the claim on a task. The
scripts serialize prefix allocation and trunk mutation with an internal
`flock` (an implementation detail, not something agents manage). Three
agent roles — a **leader**, **workers**, and **reviewers** — cooperate so that
any number of workers can run in parallel without ever editing the same file,
and a task is only ever marked `done` after an independent reviewer re-runs its
acceptance checks.

> This skill is designed for **agentic** development: one leader agent
> coordinates with you while many worker and reviewer agents execute in
> parallel. It also works fine for a single human driving it by hand.

## The three roles

All three role names are *agent nouns* — the doer of the action.

| Role | Context | Owns | Does not |
|---|---|---|---|
| **Leader** | foreground, with you | the backlog: creates & edits tickets on trunk, sets `depends_on`, dispatches workers & reviewers, merges approved branches | implement or review tasks |
| **Worker** | a worktree, one task | implements its task, self-validates against `## Acceptance`, sets `status: review` | create tickets, set `done` |
| **Reviewer** | fresh context, one task | re-runs the acceptance checks itself, writes `## Review` with a `verdict` | edit code, set `done` |

`review` → `done` is **never** on the honor system: `merge-task.sh` requires
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
  backlog (cross-story, cross-epic), not just siblings. `claim.sh` refuses to
  dispatch a task whose deps aren't all `done`.
- **Obsidian-compatible.** Tickets are frontmatter + `[[wiki-links]]`, so
  `.plan/` opens directly as an Obsidian vault (graph view, backlinks,
  properties) for a free read-only UI. Links are soft sugar, never state — no
  script parses them; gating lives only in `depends_on`, hierarchy only in
  `parent`.

## Quick start

From the repo where you want to track work (it must already be a git repo with
a trunk branch):

```bash
# 1. See the board (empty until you create tickets).
./scripts/board.sh

# 2. Create an epic, a story under it, and a task under that.
./scripts/new-ticket.sh epic   v1-ship     "Ship v1"
./scripts/new-ticket.sh story  firewall    "Network firewall"  v1-ship
./scripts/new-ticket.sh task   http-proxy  "HTTP CONNECT allowlist proxy"  firewall

# 3. Fill in each ticket body (Goal / Context / Acceptance), then:
./scripts/lint.sh          # dangling refs, cycles, duplicate slugs
git add .plan && git commit -m "backlog: v1 seed"

# 4. Dispatch a worker per ready task (deps all `done`).
./scripts/claim.sh http-proxy     # creates ../wt-http-proxy on plan/http-proxy

# 5. When the board shows a task `review` on its branch, brief a reviewer.
./scripts/review.sh http-proxy    # prints branch, worktree, acceptance, diff

# 6. When the reviewer records `verdict: approved`, merge.
./scripts/merge-task.sh http-proxy   # checks status=review + approved; flips to done
```

The scripts live in this skill's `scripts/` directory; in practice the leader
agent runs them for you.

## Scripts

| Script | Who | Purpose |
|---|---|---|
| `board.sh` | all | Read-only board: backlog from trunk + in-flight/review-ready from `plan/*` branches |
| `lint.sh` | leader | Backlog checks: dangling `parent`/`depends_on`, duplicate slugs, dependency cycles (errors); unresolved `[[links]]` (warnings) |
| `new-ticket.sh` | leader | Scaffold a ticket file with the next sort hint + slug; verifies the parent exists |
| `claim.sh` | leader | Create a worktree branch for a task; flips to `in_progress`; refuses if `depends_on` unmet |
| `review.sh` | leader/reviewer | Brief a reviewer: branch, worktree, acceptance criteria, diff vs trunk |
| `merge-task.sh` | leader | Merge an approved task (`status: review` + `verdict: approved`); flips to `done`; handles conflicts |

All scripts honor two environment variables, so the scheme works in any repo
without editing the skill:

| Var | Default | Meaning |
|---|---|---|
| `PLANR_TRUNK` | `main` | the trunk branch that holds the backlog |
| `PLANR_DIR` | `.plan` | the backlog directory |

## Ticket lifecycle

```
todo  -->  in_progress  -->  review  -->  done
                |               |              ^
                +--> blocked <--+              |
                       |                       |
                       +------ (re-dispatch) --+
```

- `todo` — created on trunk, not yet dispatched.
- `in_progress` — a worker claimed it (worktree branched); also set by a
  reviewer who requests changes.
- `review` — worker self-validated and recorded `## Validation`; awaiting
  independent review.
- `done` — a reviewer approved **and** the leader merged. Only ever appears on
  trunk after `merge-task.sh`.
- `blocked` — ad-hoc blocker a dependency can't express; reason in `## Notes`.

The ticket body grows through the lifecycle: `## Acceptance` (leader) →
`## Validation` (worker) → `## Review` (reviewer).

## Project layout

```
planr/
├── SKILL.md                     # the skill instructions (start here for agents)
├── README.md                    # this file
├── scripts/                     # board, lint, new-ticket, claim, review, merge-task
├── templates/                   # epic.md, story.md, task.md starters
├── references/
│   ├── PROCESS.md               # full process, concurrency reasoning, edge cases
│   └── TICKET-FORMAT.md         # frontmatter schema, slug rules, review format
└── tests/
    └── run-tests.sh             # end-to-end script tests in a throwaway repo
```

The only project-specific data Planr creates is the `.plan/` directory in your
repo root — commit it to trunk.

## Install

This skill is self-contained and project-agnostic. Copy the `planr/` directory
into your repo's `.agents/skills/` (project-local) or `~/.agents/skills/`
(global), then let an agent invoke it, or run the scripts directly.

## Testing

```bash
bash tests/run-tests.sh   # exercises every script + lint class end-to-end
```

Run this after changing any script.
