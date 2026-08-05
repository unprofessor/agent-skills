# Planr

Trunk-based backlog management for multi-agent development. Planr turns a
git repo into a lightweight ticket board with **no database, no server, and
no claim locks**. Tickets are markdown files under `.plan/`; the git trunk is
the board; a worktree branch *is* the claim on a task.

Three agent roles — a **leader** (plans and dispatches), **workers**
(implement one task each), and **reviewers** (independently verify) —
cooperate so that any number of workers can run in parallel without ever
editing the same file. A task is only ever marked `done` after an independent
reviewer re-runs its acceptance checks.

## Repository layout (this skill directory)

```
planr/
├── SKILL.md                     # the skill instructions (start here)
├── README.md                    # this file
├── templates/                   # epic.md, story.md, task.md starters
└── references/
    ├── PROCESS.md               # full process, concurrency reasoning, edge cases
    └── TICKET-FORMAT.md         # frontmatter schema, slug rules, review format
```

The skill is pure knowledge — no build step, no runtime dependencies, no
compiled artifacts. The CLI tool (`planr`) that automates the operations is a
separate project (see below) and is optional — the skill has full manual
fallbacks.

## CLI tool (optional, recommended)

The [`planr` CLI](https://github.com/unprofessor/planr-cli) automates ticket
creation, linting, board summaries, branch claiming, and merge gating. It is
written in Rust, distributed as a single binary (no runtime dependencies).

Install: `cargo install planr-cli` or download a release.

Without the CLI, all operations have documented manual procedures in
SKILL.md — the scheme (roles, file format, worktree discipline) is unchanged.

## The only project-specific data

Planr creates a `.plan/` directory in your repo root (epics/, stories/, tasks/).
Commit it to trunk — it IS the backlog.
