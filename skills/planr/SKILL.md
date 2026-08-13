---
name: planr
description: "Use this skill when the developer says 'we need to plan this', 'split into tasks', 'what's the dependency order', 'who's reviewing', or 'setup worktrees'. It provides trunk-based backlog management for coordinating multiple agents: a leader maintains epics, stories, and tasks as one file per ticket on trunk; each task gets one worker in a dedicated git worktree branch; a reviewer independently verifies before merge. Tickets form a dependency graph (any ticket gates any other) and cross-reference with [[wiki-links]]. Also use when maintaining a backlog, dispatching a reviewer, reviewing a task, picking up implementation, re-prioritizing, or linting for dangling references and cycles."
---

# Planr — trunk-based backlog for multi-agent work

This skill coordinates planning, execution, and review across three agent
roles. It is project-agnostic: the only project-specific data is a
git-tracked `.plan/` directory it creates in the repo root.

## Roles

- **Leader** — a *foreground* agent run in close coordination with the
  developer. It is the **single writer** to the backlog: it creates and edits
  epic/story/task files on trunk, splits and reprioritizes work, dispatches
  workers and reviewers, merges approved task branches into trunk, and
  reads the board. It does **not** implement or review tasks. Before it
  commits anything to tickets, it **asks the developer questions whenever the
  design is ambiguous or contradictory** — tickets are the design's executable
  form, and a guess baked into a ticket is far costlier to unwind than a
  two-minute clarification.
- **Worker** — an agent that implements **one task** in a dedicated git
  worktree branched off trunk. It edits only its own task file plus code,
  self-validates against the task's `## Acceptance` criteria, records a
  `## Validation` section, and sets `status: review` when it believes the
  task is complete. It does **not** mark its own task `done`.
- **Reviewer** — a *fresh-context*, independent agent that verifies a
  `review`-state task. It reads the task + acceptance criteria, reads the
  diff, and **runs the acceptance checks itself** in the worktree. It edits
  **only the task file** (never code): it adds a `## Review` section with
  `verdict: approved` or `verdict: changes-requested`. On approval the leader
  merges; on changes-requested the task returns to the worker.

`review` → `done` is **never** on the honor system: it requires an independent
reviewer's approved verdict, which `planr close task` checks before merging.

## The scheme in one paragraph

One file per ticket under `.plan/{epics,stories,tasks}/`. Filenames are
descriptive slugs with a 2-digit sort-hint prefix (`01-http-connect-proxy.md`).
Relationships point **downward is stored in the child**: a task's frontmatter
names its `parent` story and its `depends_on` prerequisites (any ticket, not
just siblings); a story names its `parent` epic. **No agent ever edits a
parent to record child progress** —
roll-up is *derived* by scanning child files on trunk at read time. There is
no central mutable index or board file that gets rewritten on every change.
Claiming a task = branching a worktree; the branch *is* the claim, so no
claim locks are needed. (The binary does use an in-process `flock` to
serialize prefix allocation and trunk mutation — see
[Concurrency](#concurrency) — but that is an implementation detail, not a
coordination primitive agents manage.)

## Trunk vs. worktree

- **Trunk** (default `main`; override with `PLANR_TRUNK`) holds the backlog and
  is the single source of truth for what tickets exist and their merged
  statuses.
- A **worktree branch** (`plan/<task-slug>`) carries one task's in-flight
  edits — its own task file + the code that implements it — and merges back as
  a unit (PR = task). Two concurrent task branches never conflict in `.plan/`
  because each touches only its own ticket file.

Read the board from **trunk plus open branches**, not just your worktree
checkout. `planr board` reads trunk via `git show` for the backlog and
scans `plan/*` branches for in-flight status (including `review`-ready), so
review-ready work is visible before merge — no checkout required.

## Orchestration with subagents

The leader delegates to subagents (workers, reviewers). Two worktree
integration patterns, chosen per dispatch:

```
A (subtree-managed): subagent runtime owns isolation via worktree:true
B (planr-claimed):   leader runs planr claim, points subagent cwd at worktree
```

Principles (both): qualify deps → assign → dispatch in waves via `runs.all`
→ batch reviewers with fresh context → close sequentially (trunk mutation is
serial). Launch workers async and continue leader work while they run.

## Leader workflow

1. With the developer, plan the work. **If the design is ambiguous or has
   contradictions** — conflicting requirements, mutually exclusive options,
   or any decision that would change the ticket structure — **ask the
   developer questions before writing anything**; never guess or silently
   pick one reading. Read the current board:

   ```bash
   planr board                            # backlog (trunk) + in-flight (branches)
   ```

2. Create tickets (epics/stories on trunk; tasks under a story, with
   `depends_on` set for ordering). Use the helper so slug/prefix
   allocation is consistent:

   ```bash
   planr new epic   v1-ship-self-hosted    "Ship v1 self-hostable hotcell"
   planr new story  network-firewall       "Network firewall"  v1-ship-self-hosted
   planr new task   http-connect-proxy     "HTTP CONNECT allowlist proxy"  network-firewall
   ```

   Then fill the body (Goal / Context / Acceptance / Notes) and edit
   `depends_on:` in frontmatter for ordering — a ticket may depend on **any**
   other ticket, not just siblings (cross-story and cross-epic gates are
   fine). After editing frontmatter, lint and commit:

   ```bash
   planr lint         # dangling parents/deps, duplicate slugs, dependency cycles
   git commit ...
   ```

   (`planr new` and `planr claim` also run lint informationally.)
3. Dispatch workers — one per **ready** task (deps all `done`) — each in its
   own worktree:

   ```bash
   planr claim http-connect-proxy   # creates ../wt-http-connect-proxy on plan/http-connect-proxy; refuses if deps unmet
   ```

   Hand the worktree path to the worker agent. To dispatch multiple workers
   in parallel, batch-claim then use `runs.all` with `cwd` per worktree
   (Pattern B), or skip `planr claim` and use `worktree: true` (Pattern A):

   ```javascript
   // Pattern B — workers in claimed worktrees
   subagent({workflowScript:`return runs.all([
     {key:"proxy", agent:"worker", task:"Implement per ##Acceptance", cwd:"../wt-http-connect-proxy"},
     {key:"dns",   agent:"worker", task:"Implement per ##Acceptance", cwd:"../wt-dns-allowlist"}
   ])`, async:true})
   ```

   Launch workers asynchronously and continue leader work while they run.
4. When the board shows a task `review` on its branch, dispatch a reviewer:

   ```bash
   planr review http-connect-proxy   # prints branch, worktree, acceptance, diff
   ```

   Hand that to a fresh-context review agent. For multiple review-ready
   tasks, dispatch reviewers in parallel:

   ```javascript
   subagent({workflowScript:`return runs.all([
     {key:"r-proxy", agent:"reviewer", task:"Review per ##Acceptance", cwd:"../wt-http-connect-proxy"},
     {key:"r-dns",   agent:"reviewer", task:"Review per ##Acceptance", cwd:"../wt-dns-allowlist"}
   ])`, context:"fresh", async:true})
   ```

   On `changes-requested` re-dispatch the worker to the same worktree
   (branch and worktree are preserved).
5. When the reviewer records `verdict: approved`, close the task:

   ```bash
   planr close task http-connect-proxy   # checks status=review + approved verdict; flips to done on branch; merges; cleans up
   ```

   On a merge conflict it aborts and prints rebase guidance for the worker.
   Other in-flight task branches merge independently and conflict-free in
   `.plan/`. Close approved tasks sequentially (trunk mutation is serial).

When all children of a story or epic are done, close the parent:

   ```bash
   planr close story network-firewall     # gates on all child tasks done; flips done before final merge
   planr close epic   v1-ship-self-hosted # gates on all child stories done; flips done before final merge
   ```

See [references/PROCESS.md](references/PROCESS.md) for the full process,
concurrency reasoning, review/validation detail, and edge cases.

## Concurrency

Two operations need serialization: `planr new` (prefix allocation) and
`planr close task` (trunk mutation). The `planr` binary handles this with
an in-process `flock` — no action needed from agents. See
[references/PROCESS.md](references/PROCESS.md#concurrency-notes) for details.

## Worker workflow

1. Start in your assigned worktree (path given by the leader). The task
   file is already flipped to `in_progress` by `planr claim`.
2. Read your task file (`.plan/tasks/<NN>-<slug>.md`) and its parent story for
   context. Note `depends_on` — those tickets are `done` (planr claim checked).
   Follow `[[wiki-links]]` in the body for related context.
3. **Edit only your task file and code.** Do not edit any other `.plan/` file
   — not the parent story, not siblings.
4. Implement. Keep task-file `## Notes` updated as a log.
5. **Validate before declaring review.** For each item in `## Acceptance`,
   verify it yourself (run the tests, check the behavior). Append a
   `## Validation` section recording what you checked — commands run and their
   results. Only when every acceptance criterion is met:
   - set `status: review`,
   - bump `updated:`,
   - commit, and hand the branch back to the leader.
6. Do not create new tickets, and do not set `status: done` — that is the
   reviewer + leader's job. If you discover missing work, note it in
   `## Notes` for the leader to triage.

## Reviewer workflow

1. You run in **fresh context** in the task's worktree (path from
   `planr review`). You are independent of the worker; do not trust the
   worker's self-validation — re-check.
2. Read the task file's `## Acceptance` and `## Validation`, the parent story,
   and the diff (`planr review` prints it). **Run the acceptance checks
   yourself** in the worktree.
3. **Edit only the task file** — never code. Add a `## Review` section:

   ```markdown
   ## Review
   verdict: approved          # or: changes-requested
   reviewer: <your id>
   date: 2025-07-29
   <what you checked and the result>
   ```

4. If `approved`: leave `status: review`, commit, hand back to the leader
   to close.
5. If `changes-requested`: set `verdict: changes-requested`, **flip
   `status: in_progress`**, record concretely what failed, commit, and hand
   back. The leader re-dispatches the worker.

## Ticket format

One file per ticket under `.plan/{epics,stories,tasks}/`. See
[references/TICKET-FORMAT.md](references/TICKET-FORMAT.md) for schema, slug
rules, status lifecycle, and review format; [templates/](templates/) for
starter files.

## Links between tickets

Ticket bodies may use `[[slug]]` wiki-links for soft cross-references. Links
are sugar — ordering and gating live only in `depends_on` and `parent`. See
[references/TICKET-FORMAT.md](references/TICKET-FORMAT.md#wiki-links-soft-references)
for details.

## Commands

| Command | Who | Purpose |
| --- | --- | --- |
| `planr board` | all | Read-only board: backlog from trunk + in-flight/review-ready from `plan/*` branches |
| `planr lint` | leader | Backlog checks: dangling `parent`/`depends_on`, duplicate slugs, dependency cycles (errors); unresolved `[[links]]` (warnings). Lints the working tree, or a ref (`planr lint main`) |
| `planr new` | leader | Scaffold a ticket file with next sort-hint + slug; verifies the parent exists; runs lint informationally |
| `planr claim` | leader | Create a worktree branch for a task; flips to `in_progress`; refuses if `depends_on` unmet |
| `planr review` | leader/reviewer | Brief a reviewer: branch, worktree, acceptance criteria, diff vs trunk |
| `planr close task` | leader | Merge an approved task (`status: review` + `verdict: approved`); flips to `done` on the branch before merge; handles conflicts with guidance |
| `planr close story` | leader | Gate all child tasks done → flip story `done` before final task merge |
| `planr close epic` | leader | Gate all child stories done → flip epic `done` before final story merge |

All commands honor `PLANR_TRUNK` (default `main`) and `PLANR_DIR` (default
`.plan`) env vars, so the scheme works in any repo without editing the skill.

**Implementation:** all subcommands are implemented in a single Rust
binary (`planr`). The binary embeds its own YAML parser and templates — no
runtime dependencies beyond the binary itself.

## Workflow templates

### Parallel workers (Pattern B)

```javascript
subagent({workflowScript:`return runs.all([
  {key:"a", agent:"worker", task:"Implement task-a", cwd:"../wt-task-a"},
  {key:"b", agent:"worker", task:"Implement task-b", cwd:"../wt-task-b"}
])`, async:true})
```

### Parallel reviewers

```javascript
subagent({workflowScript:`return runs.all([
  {key:"r-a", agent:"reviewer", task:"Review task-a", cwd:"../wt-task-a"},
  {key:"r-b", agent:"reviewer", task:"Review task-b", cwd:"../wt-task-b"}
])`, context:"fresh", async:true})
```

### Subtree-managed (Pattern A)

```javascript
subagent({workflowScript:`return runs.all([
  {key:"a", agent:"worker", task:"Implement feature A", worktree:true},
  {key:"b", agent:"worker", task:"Implement feature B", worktree:true}
])`, async:true})
```

### Sequential waves (depends_on chain)

```javascript
// Wave 1 — planr claim core && planr claim cfg
subagent({workflowScript:`return runs.all([
  {key:"core", agent:"worker", task:"Core lib", cwd:"../wt-core"},
  {key:"cfg",  agent:"worker", task:"Config",   cwd:"../wt-config"}
])`, async:true})

// After wave 1 closes: planr close task core && planr close task cfg

// Wave 2
subagent({workflowScript:`return runs.all([
  {key:"api", agent:"worker", task:"REST API (depends core+cfg)", cwd:"../wt-api"},
  {key:"cli", agent:"worker", task:"CLI (depends core+cfg)",     cwd:"../wt-cli"}
])`, async:true})
```

## Installing planr

```bash
# From source (requires Rust)
cargo install --git https://github.com/unprofessor/planr-rs.git

# Or download a prebuilt release from:
# https://github.com/unprofessor/planr-rs/releases
```

Verify installation:

```bash
planr --version    # confirm the binary is installed
planr --help       # full usage
```

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Merge conflict on close | `cd $wt && git rebase main`, resolve, `git rebase --continue`, re-run `planr close task <slug>` |
| Stale worktree (branch gone) | `git worktree prune && git worktree remove ../wt-<slug> -f` |
| Worker disconnected mid-task | Read `## Notes` + `git log` in worktree; re-dispatch worker to same worktree |
| Reviewer path not found | Worktree is always `../wt-<slug>/` — verify with `git worktree list` |
| `planr lint` reports a cycle | Edit `depends_on` to break the loop; `planr lint` to confirm; commit |
| `planr claim` refuses (unmet deps) | Check `planr board` for blockers; dispatch those first or edit `depends_on` |
| `planr close` refuses (not review or no approval) | Not `status: review`? Worker self-validate. No approved verdict? Dispatch reviewer. |

## Extracting this skill

This skill is self-contained and project-agnostic. To use it in another
project, copy `skills/planr/` from the `agent-skills` tap into that repo's
`.agents/skills/` (or `~/.agents/skills/` for global use). The `.plan/`
directory it produces is the only project-specific data. The `planr` binary
must be installed separately (see [Installing planr](#installing-planr)).
