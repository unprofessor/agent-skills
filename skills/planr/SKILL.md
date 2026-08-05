---
name: planr
description: "Use this skill when the developer says 'we need to plan this', 'split into tasks', 'what's the dependency order', 'who's reviewing', or 'setup worktrees'. It provides trunk-based backlog management for coordinating multiple agents: a leader maintains epics, stories, and tasks as one file per ticket on trunk; each task gets one worker in a dedicated git worktree branch; a reviewer independently verifies before merge. Tickets form a dependency graph (any ticket gates any other) and cross-reference with [[wiki-links]]. Also use when maintaining a backlog, dispatching a reviewer, reviewing a task, picking up implementation, re-prioritizing, or linting for dangling references and cycles."
---

# Planr — trunk-based backlog for multi-agent work

## Canonical source

This skill is published to the `unprofessor/agent-skills` tap (repo:
[`skills/planr`](https://github.com/unprofessor/agent-skills/tree/main/skills%2Fplanr)).
The repo copy is authoritative.

- **Iterate locally, converge in the repo.** Editing the installed copy is
  fine for rapid iteration (the harness loads it), but the repo copy is
  authoritative: sync back when the change stabilizes, then refresh installed
  copies. Never leave the two divergent at session end.
- **Policy/behavior changes go through the repo PR flow** — that's the review
  gate. Mechanics (scripts, wording) may iterate locally first.
- The tap may host other skills; keep changes scoped to this skill's dir.

This skill coordinates planning, execution, and review across three agent
roles. It is project-agnostic: the only project-specific data is a
git-tracked `.plan/` directory it creates in the repo root.

## Roles

- **Leader** — a *foreground* agent run in close coordination with the
  developer. It is the **single writer** to the backlog: it creates and edits
  epic/story/task files on trunk, splits and reprioritizes work, dispatches
  workers and reviewers, merges approved task branches into trunk, and
  regenerates the board. It does **not** implement or review tasks. Planning
  is a single session with the developer, but an agent scaffolding a whole
  epic will rationally fire several `new-ticket` invocations in one parallel
  tool block — so the CLI serializes prefix allocation and trunk mutation
  with a `flock` (see [Concurrency](#concurrency) below) rather than rely on
  the session being strictly sequential.
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

`review` -> `done` is **never** on the honor system: it requires an independent
reviewer's approved verdict, which `planr merge-task` checks before merging.

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
claim locks are needed. (The CLI uses a `flock` internally to serialize
prefix allocation and trunk mutation — see [Concurrency](#concurrency) — but
that is an implementation detail, not a coordination primitive agents manage.)

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

## Command-line tool (optional enhancement)

The `planr` CLI automates backlog operations — prefix allocation, linting,
board summaries, branch claiming, and merge gating. It is a **separate
project** at [github.com/unprofessor/planr-cli](https://github.com/unprofessor/planr-cli).

**When the CLI is installed**, invoke `planr <command>` directly:

| Command | Who | Purpose |
| --- | --- | --- |
| `planr board` | all | Read-only board: backlog from trunk + in-flight/review-ready from `plan/*` branches |
| `planr lint` | leader | Backlog checks: dangling `parent`/`depends_on`, duplicate slugs, dependency cycles (errors); unresolved `[[links]]` (warnings). Lints the working tree, or a ref (`planr lint main`) |
| `planr new-ticket <kind> <slug> <title>` | leader | Scaffold a ticket file with next sort-hint + slug; verifies the parent exists; runs lint |
| `planr claim <slug>` | leader | Create a worktree branch for a task; flips to `in_progress`; refuses if `depends_on` unmet |
| `planr review <slug>` | leader/reviewer | Brief a reviewer: branch, worktree, acceptance criteria, diff vs trunk |
| `planr merge-task <slug>` | leader | Merge an approved task (`status: review` + `verdict: approved`); flips to `done`; handles conflicts with guidance |

**Installation:**

```bash
# Via cargo (if Rust is installed):
cargo install planr-cli

# Direct binary download (GitHub Releases — coming soon):
# Download from https://github.com/unprofessor/planr-cli/releases
```

All CLI operations honor `PLANR_TRUNK` (default `main`) and `PLANR_DIR` (default
`.plan`) env vars, so the scheme works in any repo without editing the skill.

**When the CLI is NOT available (low-fidelity fallback):** the skill degrades
gracefully — all CLI operations have documented manual procedures below.
Operate without the CLI: create ticket files by hand from templates, run
`git` commands directly, and verify against
[references/TICKET-FORMAT.md](references/TICKET-FORMAT.md). The fallback is
more laborious but the scheme (roles, file format, worktree discipline) works
unchanged.

## Leader workflow

1. With the developer, plan the work. Read the current board:

   ```bash
   planr board                              # backlog (trunk) + in-flight (branches)
   ```

   If `planr` is not installed:

   ```bash
   git show main:.plan/tasks/              # trunk backlog by kind
   git branch --list 'plan/*'             # in-flight branches + status
   ```

2. Create tickets (epics/stories on trunk; tasks under a story, with
   `depends_on` set for ordering). Use `planr new-ticket` so slug/prefix
   allocation is consistent:

   ```bash
   planr new-ticket epic   v1-ship-self-hosted    "Ship v1 self-hostable hotcell"
   planr new-ticket story  network-firewall       "Network firewall"  v1-ship-self-hosted
   planr new-ticket task   http-connect-proxy     "HTTP CONNECT allowlist proxy"  network-firewall
   ```

   Without the CLI: copy a ticket template from
   [templates/](templates/), compute the next sort-prefix (`ls .plan/tasks/ |
   tail -1 | grep -o '^[0-9]*'`), fill frontmatter manually, then lint.

   Then fill the body (Goal / Context / Acceptance / Notes) and edit
   `depends_on:` in frontmatter for ordering — a ticket may depend on **any**
   other ticket, not just siblings (cross-story and cross-epic gates are
   fine). After editing frontmatter, lint and commit:

   ```bash
   planr lint                               # dangling parents/deps, duplicate slugs, dependency cycles
   git commit ...
   ```

   (Without the CLI: verify `parent` exists, check `depends_on` slugs are
   valid ticket files, scan for `[[duplicate-slugs]]` — the reference format
   documents all rules.)

   (`planr new-ticket` and `planr claim` also run lint informationally.)

3. Dispatch workers — one per **ready** task (deps all `done`) — each in its
   own worktree:

   ```bash
   planr claim http-connect-proxy           # creates ../wt-http-connect-proxy on plan/http-connect-proxy; refuses if deps unmet
   ```

   Without CLI:
   ```bash
   git worktree add -b plan/http-connect-proxy main
   # then edit .plan/tasks/<NN>-http-connect-proxy.md: set status: in_progress
   git add .plan && git commit -m "claim http-connect-proxy"
   ```

   Hand the worktree path to the worker agent.

4. When the board shows a task `review` on its branch, dispatch a reviewer:

   ```bash
   planr review http-connect-proxy          # prints branch, worktree, acceptance, diff
   ```

   Without CLI:
   ```bash
   git worktree list | grep plan/http-connect-proxy
   git show plan/http-connect-proxy:.plan/tasks/<NN>-http-connect-proxy.md
   git diff main...plan/http-connect-proxy
   ```

   Hand that to a fresh-context review agent.

5. When the reviewer records `verdict: approved`, merge:

   ```bash
   planr merge-task http-connect-proxy     # checks status=review + approved verdict; merges; flips to done
   ```

   Without CLI:
   ```bash
   # Verify: status=review, ## Review section exists with verdict: approved
   git checkout main && git merge --no-ff plan/http-connect-proxy
   # Flip status: done in the merged task file
   git add .plan && git commit -m "merge http-connect-proxy (done)"
   git branch -d plan/http-connect-proxy
   ```

   On a merge conflict the CLI aborts and prints rebase guidance for the
   worker. Other in-flight task branches merge independently and
   conflict-free in `.plan/`.

See [references/PROCESS.md](references/PROCESS.md) for the full process,
concurrency reasoning, review/validation detail, and edge cases.

## Concurrency

The claim mechanism needs no locks — a worktree branch *is* the claim, so two
agents cannot both claim the same task. But two operations do mutate shared
state in the working tree and need serialization:

- **Prefix allocation** (`planr new-ticket`) is a read-modify-write on a kind's
  directory: `ls` for the highest `NN`, then write `NN+1`. Without a lock,
  parallel invocations (an agent scaffolding a whole epic in one tool block)
  all read the same `ls` and all compute the same `NN`, producing colliding
  sort-hints — different slugs, so the existence guard never trips.
- **Trunk mutation** (`planr merge-task`) checks out trunk, merges, flips
  status, and commits; it must not race a reader mid-scan or another writer.

So the CLI shares a single `flock` on
`$(git rev-parse --git-common-dir)/planr.lock`: writers (`planr new-ticket`,
`planr merge-task`) take an **exclusive** lock for their critical section;
readers (`planr board`, `planr review`, `planr claim`, working-tree
`planr lint`) take a **shared** lock so they see a consistent snapshot. `flock`
is from util-linux (standard on Linux). The lock file lives in the git common
dir, shared across worktrees and never committed. `planr new-ticket` also
re-scans after writing and bails if its `NN` is no longer unique — a defensive
check against manual edits or a future regression that bypasses the lock. See
[references/PROCESS.md](references/PROCESS.md#concurrency-notes) for the full
reasoning.

When operating without the CLI (fallback), there is no lock: serialize
manually — do not run prefix allocation or trunk mutations in parallel.

## Worker workflow

1. Start in your assigned worktree (path given by the leader). The task
   file is already flipped to `in_progress` by `planr claim`.
2. Read your task file (`.plan/tasks/<NN>-<slug>.md`) and its parent story for
   context. Note `depends_on` — those tickets are `done` (`planr claim` checked).
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
   to merge.
5. If `changes-requested`: set `verdict: changes-requested`, **flip
   `status: in_progress`**, record concretely what failed, commit, and hand
   back. The leader re-dispatches the worker.

## Ticket format

Descriptive slug filenames, YAML frontmatter + markdown body. Frontmatter
includes `depends_on` (slugs of any tickets that must be `done` before this
one is dispatchable). The body grows through the lifecycle: `## Acceptance`
(created by the leader) -> `## Validation` (worker) -> `## Review` (reviewer). See
[references/TICKET-FORMAT.md](references/TICKET-FORMAT.md) for the full schema,
slug rules, status lifecycle, and review format; [templates/](templates/) has
starter files.

## Links between tickets (Obsidian-compatible)

Ticket bodies may reference other tickets with `[[slug]]` wiki-links —
`[[http-connect-proxy]]`, or `[[http-connect-proxy|the proxy task]]` — for
*soft* relationships: related work, "discovered while working on", "supersedes",
links from a `## Notes` log to the ticket that triaged it. Two hard rules:

- **Links are sugar, never state.** No script parses body links; ordering and
  gating live only in `depends_on`, hierarchy only in `parent`. `planr lint`
  *warns* (never errors) when a link matches no ticket slug.
- **Backlinks are derived, never stored** — same philosophy as roll-up:

  ```bash
  grep -rn '\[\[http-connect-proxy' .plan/   # who references this ticket?
  ```

Because tickets are frontmatter + wiki-links, `.plan/` opens directly as an
**Obsidian vault** — graph view, backlinks pane, and properties work out of the
box, giving you a free read-only UI. The `aliases: [<slug>]` frontmatter field
(in the templates) is what lets Obsidian resolve `[[slug]]` to the
`NN-slug.md` file despite the sort-prefix. One caveat: a vault shows the
*working tree* — the authoritative board is trunk + in-flight branches, which
only `planr board` sees.

## Troubleshooting

### Merge conflict during `planr merge-task`

**Symptom:** `planr merge-task` prints "merge conflict in: <file>" and aborts.
**Cause:** Another task's branch merged since this worktree was cut, touching the same code.
**Resolution:** The worktree and branch are preserved. Rebase onto fresh trunk:

```bash
cd $wt                        # the worktree path printed during merge-task
# or find it: git worktree list
git rebase main               # resolve conflicts, git add, git rebase --continue
# then the leader re-runs: planr merge-task <slug>
```

This is a real signal the tasks overlap — consider re-splitting the work if
rebases keep hurting.

---

### Stale worktree after branch cleanup

**Symptom:** A worktree directory exists but its branch was already merged
or deleted. `git worktree list` shows the worktree but `git branch` does not.
**Cause:** The merge succeeded but the worktree removal was interrupted
(e.g., agent disconnected mid-merge).
**Resolution:**

```bash
# Remove the stale worktree
git worktree prune
git worktree remove ../wt-<slug> -f   # if prune alone doesn't clear it
```

---

### Worker interrupted mid-task

**Symptom:** A worktree branch exists with `status: in_progress` but the
worker agent disconnected. The leader needs to recover progress.
**Resolution:**

1. Read the task file in the worktree: `cat .plan/tasks/<NN>-<slug>.md` —
   check the `## Notes` section for findings already logged.
2. Check `git log` in the worktree for incremental commits the worker made.
3. Check for uncommitted changes: `git status` in the worktree.
4. Re-dispatch the same worker (or a fresh one) to the same worktree.
   The worker picks up from `## Notes` and any staged/uncommitted work.

The leader can also use `planr review <slug>` (read-only) to inspect
the branch without entering the worktree.

---

### Reviewer cannot find the worktree

**Symptom:** The review agent says "I don't see the worktree" or "path
not found."
**Cause:** The leader dispatched the reviewer without the worktree path, or
the reviewer is running in a different shell session.
**Resolution:**

```bash
# The leader runs: planr review <slug>
# This prints the worktree path, branch, acceptance, and diff.
#
# Fallback if planr is unavailable:
git worktree list
```

The worktree is always at `../wt-<slug>/` relative to the repo root.

---

### Dependency cycle detected

**Symptom:** `planr lint` prints:

```
depends_on cycle: A -> B -> C -> A — nothing in the cycle can ever be claimed
```

**Cause:** Two or more tickets list each other in `depends_on`, forming a
loop. Tickets in a cycle can never all be `done` because each waits on
another.
**Resolution:**

1. Read the cycle path from the error (e.g., `http-connect -> firewall -> http-connect`).
2. One of the edges is wrong — the dependency goes the opposite direction
   or shouldn't exist.
3. Edit `depends_on` on trunk for the offending ticket(s) to break the loop.
4. Re-run `planr lint` to confirm the cycle is gone.
5. Commit the fix.

---

### Cross-platform sed issues

**Symptom:** `planr` or another tool fails on macOS with "invalid flag"
or unexpected output.
**Cause:** BSD `sed` (macOS default) uses different flag syntax than GNU
`sed` (Linux, WSL, Git for Windows). The CLI is tested on Linux; on macOS
GNU sed may be needed.
**Resolution:**

```bash
# Install GNU sed
brew install gnu-sed
# Make it the default for sed calls
export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:$PATH"
```

---

### "refuse claim" — task has unfinished dependencies

**Symptom:** `planr claim` prints:

```
refuse claim: '<slug>' has unfinished depends_on: <list>
resolve or complete these first, or have the leader update depends_on.
```

**Cause:** One or more of the task's `depends_on` prerequisites are not
`status: done` on trunk.
**Resolution:**

- Check `planr board` for the blockers' statuses.
- Dispatch those tasks first, or ask the leader to update `depends_on` if
the dependency is incorrect.

---

### "refuse merge" — task not in review or no approval

**Symptom:** `planr merge-task` prints:

```
refuse merge: task '<slug>' status is '<status>', must be 'review'
# or:
refuse merge: no approved review verdict on '<slug>'
```

**Cause:** The task hasn't been validated and flipped to `status: review`
by the worker, or hasn't been reviewed and approved by an independent
reviewer.
**Resolution:**

- If status isn't `review`: the worker must self-validate and set
  `status: review` first.
- If status is `review` but no approved verdict: dispatch a reviewer via
  `planr review <slug>`.

## Extracting this skill

This skill is self-contained and project-agnostic. To use it in another
project, copy `.agents/skills/planr/` into that repo's `.agents/skills/` (or
`~/.agents/skills/` for global use). The `.plan/` directory it produces is the
only project-specific data.

The CLI tool (`planr`) is optional but recommended — install separately from
[github.com/unprofessor/planr-cli](https://github.com/unprofessor/planr-cli).
Without the CLI, all operations have manual fallback procedures (documented
alongside each `planr` command above).
