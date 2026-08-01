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
  regenerates the board. It does **not** implement or review tasks. Planning
  is a single session with the developer, but an agent scaffolding a whole
  epic will rationally fire several `new-ticket.sh` calls in one parallel
  tool block — so the scripts serialize prefix allocation and trunk mutation
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

`review` → `done` is **never** on the honor system: it requires an independent
reviewer's approved verdict, which `merge-task.sh` checks before merging.

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
claim locks are needed. (The scripts do use a `flock` internally to serialize
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
checkout. `scripts/board.sh` reads trunk via `git show` for the backlog and
scans `plan/*` branches for in-flight status (including `review`-ready), so
review-ready work is visible before merge — no checkout required.

## Leader workflow

1. With the developer, plan the work. Read the current board:

   ```bash
   ./scripts/board.sh                       # backlog (trunk) + in-flight (branches)
   ```

2. Create tickets (epics/stories on trunk; tasks under a story, with
   `depends_on` set for ordering). Use the helper so slug/prefix
   allocation is consistent:

   ```bash
   ./scripts/new-ticket.sh epic   v1-ship-self-hosted    "Ship v1 self-hostable hotcell"
   ./scripts/new-ticket.sh story  network-firewall       "Network firewall"  v1-ship-self-hosted
   ./scripts/new-ticket.sh task   http-connect-proxy     "HTTP CONNECT allowlist proxy"  network-firewall
   ```

   Then fill the body (Goal / Context / Acceptance / Notes) and edit
   `depends_on:` in frontmatter for ordering — a ticket may depend on **any**
   other ticket, not just siblings (cross-story and cross-epic gates are
   fine). After editing frontmatter, lint and commit:

   ```bash
   ./scripts/lint.sh   # dangling parents/deps, duplicate slugs, dependency cycles
   git commit ...
   ```

   (`new-ticket.sh` and `claim.sh` also run the lint informationally.)
3. Dispatch workers — one per **ready** task (deps all `done`) — each in its
   own worktree:

   ```bash
   ./scripts/claim.sh http-connect-proxy   # creates ../wt-http-connect-proxy on plan/http-connect-proxy; refuses if deps unmet
   ```

   Hand the worktree path to the worker agent.
4. When the board shows a task `review` on its branch, dispatch a reviewer:

   ```bash
   ./scripts/review.sh http-connect-proxy   # prints branch, worktree, acceptance, diff
   ```

   Hand that to a fresh-context review agent.
5. When the reviewer records `verdict: approved`, merge:

   ```bash
   ./scripts/merge-task.sh http-connect-proxy   # checks status=review + approved verdict; merges; flips to done
   ```

   On a merge conflict it aborts and prints rebase guidance for the worker.
   Other in-flight task branches merge independently and conflict-free in
   `.plan/`.

See [references/PROCESS.md](references/PROCESS.md) for the full process,
concurrency reasoning, review/validation detail, and edge cases.

## Concurrency

The claim mechanism needs no locks — a worktree branch *is* the claim, so two
agents cannot both claim the same task. But two operations do mutate shared
state in the working tree and need serialization:

- **Prefix allocation** (`new-ticket.sh`) is a read-modify-write on a kind's
  directory: `ls` for the highest `NN`, then write `NN+1`. Without a lock,
  parallel invocations (an agent scaffolding a whole epic in one tool block)
  all read the same `ls` and all compute the same `NN`, producing colliding
  sort-hints — different slugs, so the existence guard never trips.
- **Trunk mutation** (`merge-task.sh`) checks out trunk, merges, flips status,
  and commits; it must not race a reader mid-scan or another writer.

So the scripts share a single `flock` on `$(git rev-parse --git-common-dir)/planr.lock`:
writers (`new-ticket.sh`, `merge-task.sh`) take an **exclusive** lock for their
critical section; readers (`board.sh`, `review.sh`, `claim.sh`, working-tree
`lint.sh`) take a **shared** lock so they see a consistent snapshot. `flock` is
from util-linux (standard on Linux). The lock file lives in the git common dir,
shared across worktrees and never committed. `new-ticket.sh` also re-scans
after writing and bails if its `NN` is no longer unique — a defensive check
against manual edits or a future regression that bypasses the lock. See
[references/PROCESS.md](references/PROCESS.md#concurrency-notes) for the full
reasoning.

## Worker workflow

1. Start in your assigned worktree (path given by the leader). The task
   file is already flipped to `in_progress` by `claim.sh`.
2. Read your task file (`.plan/tasks/<NN>-<slug>.md`) and its parent story for
   context. Note `depends_on` — those tickets are `done` (claim.sh checked).
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
   `scripts/review.sh`). You are independent of the worker; do not trust the
   worker's self-validation — re-check.
2. Read the task file's `## Acceptance` and `## Validation`, the parent story,
   and the diff (`scripts/review.sh` prints it). **Run the acceptance checks
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
(created by the leader) → `## Validation` (worker) → `## Review` (reviewer). See
[references/TICKET-FORMAT.md](references/TICKET-FORMAT.md) for the full schema,
slug rules, status lifecycle, and review format; [templates/](templates/) has
starter files.

## Links between tickets (Obsidian-compatible)

Ticket bodies may reference other tickets with `[[slug]]` wiki-links —
`[[http-connect-proxy]]`, or `[[http-connect-proxy|the proxy task]]` — for
*soft* relationships: related work, "discovered while working on", "supersedes",
links from a `## Notes` log to the ticket that triaged it. Two hard rules:

- **Links are sugar, never state.** No script parses body links; ordering and
  gating live only in `depends_on`, hierarchy only in `parent`. `lint.sh`
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
only `scripts/board.sh` sees.

## Scripts

| Script | Who | Purpose |
| --- | --- | --- |
| `scripts/board.sh` | all | Read-only board: backlog from trunk + in-flight/review-ready from `plan/*` branches |
| `scripts/lint.sh` | leader | Backlog checks: dangling `parent`/`depends_on`, duplicate slugs, dependency cycles (errors); unresolved `[[links]]` (warnings). Lints the working tree, or a ref (`lint.sh main`) |
| `scripts/new-ticket.sh` | leader | Scaffold a ticket file with next sort-hint + slug; verifies the parent exists; runs `lint.sh` |
| `scripts/claim.sh` | leader | Create a worktree branch for a task; flips to `in_progress`; refuses if `depends_on` unmet |
| `scripts/review.sh` | leader/reviewer | Brief a reviewer: branch, worktree, acceptance criteria, diff vs trunk |
| `scripts/merge-task.sh` | leader | Merge an approved task (`status: review` + `verdict: approved`); flips to `done`; handles conflicts with guidance |

All scripts honor `PLANR_TRUNK` (default `main`) and `PLANR_DIR` (default
`.plan`) env vars, so the scheme works in any repo without editing the skill.

**Implementation:** all six scripts are TypeScript, bundled into
`dist/cli/*.cjs`; the `.sh` files are thin shims (`exec node
"$(dirname "$0")/../dist/cli/<name>.cjs" "$@"`) so invocation is unchanged.
The bundle includes the YAML parser — no `node_modules` is needed at
runtime. `npm run build` (dev-time) regenerates `dist/`; the shipped skill
folder carries its own `dist/` so the copy stays self-contained.

`tests/run-tests.sh` exercises the scripts end-to-end in a throwaway git repo
(creation guards, cross-story dependency gating, every lint class); run it
after changing any script.

## Troubleshooting

### Merge conflict during `merge-task.sh`

**Symptom:** `merge-task.sh` prints "merge conflict in: <file>" and aborts.
**Cause:** Another task's branch merged since this worktree was cut, touching the same code.
**Resolution:** The worktree and branch are preserved. Rebase onto fresh trunk:

```bash
cd $wt                        # the worktree path printed during merge-task
# or find it: git worktree list
git rebase main               # resolve conflicts, git add, git rebase --continue
# then the leader re-runs: scripts/merge-task.sh <slug>
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

The leader can also use `scripts/review.sh <slug>` (read-only) to inspect
the branch without entering the worktree.

---

### Reviewer cannot find the worktree

**Symptom:** The review agent says "I don't see the worktree" or "path
not found."
**Cause:** The leader dispatched the reviewer without the worktree path, or
the reviewer is running in a different shell session.
**Resolution:**

```bash
# The leader runs: scripts/review.sh <slug>
# This prints the worktree path, branch, acceptance, and diff.
#
# Fallback if review.sh is unavailable:
git worktree list
```

The worktree is always at `../wt-<slug>/` relative to the repo root.

---

### Dependency cycle detected

**Symptom:** `scripts/lint.sh` prints:

```
depends_on cycle: A → B → C → A — nothing in the cycle can ever be claimed
```

**Cause:** Two or more tickets list each other in `depends_on`, forming a
loop. Tickets in a cycle can never all be `done` because each waits on
another.
**Resolution:**

1. Read the cycle path from the error (e.g., `http-connect → firewall → http-connect`).
2. One of the edges is wrong — the dependency goes the opposite direction
   or shouldn't exist.
3. Edit `depends_on` on trunk for the offending ticket(s) to break the loop.
4. Re-run `scripts/lint.sh` to confirm the cycle is gone.
5. Commit the fix.

---

### Cross-platform sed issues

**Symptom:** `scripts/lint.sh` or another script fails on macOS with
"invalid flag" or unexpected output.
**Cause:** BSD `sed` (macOS default) uses different flag syntax than GNU
`sed` (Linux, WSL, Git for Windows). The scripts are written for GNU sed.
**Resolution:**

```bash
# Install GNU sed
brew install gnu-sed
# Make it the default for sed calls
export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:$PATH"
```

After this, `sed` invocations in scripts work as written. The scripts
shipped with planr use GNU sed features (`-E` extended regex, `+` repetition)
that BSD sed does not support.

---

### "refuse claim" — task has unfinished dependencies

**Symptom:** `scripts/claim.sh` prints:

```
refuse claim: '<slug>' has unfinished depends_on: <list>
resolve or complete these first, or have the leader update depends_on.
```

**Cause:** One or more of the task's `depends_on` prerequisites are not
`status: done` on trunk.
**Resolution:**

- Check `scripts/board.sh` for the blockers' statuses.
- Dispatch those tasks first, or ask the leader to update `depends_on` if
the dependency is incorrect.

---

### "refuse merge" — task not in review or no approval

**Symptom:** `scripts/merge-task.sh` prints:

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
  `scripts/review.sh <slug>`.

## Extracting this skill

This skill is self-contained and project-agnostic. To use it in another
project, copy `.agents/skills/planr/` into that repo's `.agents/skills/` (or
`~/.agents/skills/` for global use). The `.plan/` directory it produces is the
only project-specific data.

**Build step (dev-time only):** the skill ships as compiled JS. In the
source repo, run `npm install && npm run build` to regenerate `dist/cli/*.cjs`
(esbuild bundles the TypeScript + YAML parser into each CLI). The skill folder
includes its built `dist/`, so the copy at the target is fully self-contained
— no `npm install` or build is needed there. If you are copying from a
fresh clone, build first, then copy the folder *including* its `dist/`.
