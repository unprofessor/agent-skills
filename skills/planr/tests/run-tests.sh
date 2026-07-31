#!/usr/bin/env bash
# End-to-end tests for the planr skill scripts, run in a throwaway git repo.
#
# Usage: tests/run-tests.sh [sandbox-dir]
#        With no argument, uses a fresh mktemp dir (removed on success, kept
#        and printed on failure). An explicit sandbox-dir must not exist yet
#        and is always kept.
#
# Covers: ticket creation guards (dangling parent, bad slug), template
# alias fill, cross-story depends_on gating through claim.sh, every lint.sh
# error class, lint warning-vs-error exit codes, ref-mode lint, and the
# stdout/stderr contract of new-ticket.sh.
set -uo pipefail

skill="$(cd "$(dirname "$0")/.." && pwd)"

keep=0
if [[ -n "${1:-}" ]]; then
  root="$1"
  if [[ -e "$root" ]]; then
    echo "refusing to test in existing path: $root" >&2
    exit 1
  fi
  keep=1
else
  root="$(mktemp -d)"
fi
repo="$root/repo"
mkdir -p "$repo"
cd "$repo"

pass=0; fail=0
check() { # check <desc> <expected-exit> <actual-exit>
  if [[ "$2" == "$3" ]]; then pass=$((pass+1)); echo "PASS: $1";
  else fail=$((fail+1)); echo "FAIL: $1 (want exit $2, got $3)"; fi
}
contains() { # contains <desc> <needle> <file>
  if grep -qF "$2" "$3"; then pass=$((pass+1)); echo "PASS: $1";
  else fail=$((fail+1)); echo "FAIL: $1 (no '$2' in $3)"; cat "$3"; fi
}

git init -q -b main .
git config user.email planr-tests@example.invalid
git config user.name "planr tests"
git commit -q --allow-empty -m init

out="$root/out"; errf="$root/err"

# --- new-ticket guards ---
"$skill/scripts/new-ticket.sh" task bad "Orphan" no-such-parent >"$out" 2>"$errf"
check "new-ticket refuses dangling parent" 1 $?
contains "  ...with a clear message" "create the parent first" "$errf"

"$skill/scripts/new-ticket.sh" epic "Bad Slug!" "Nope" >"$out" 2>"$errf"
check "new-ticket refuses non-kebab slug" 1 $?

"$skill/scripts/new-ticket.sh" epic foo- "Trailing hyphen" >"$out" 2>"$errf"
check "new-ticket refuses trailing-hyphen slug" 1 $?
"$skill/scripts/new-ticket.sh" epic foo--bar "Double hyphen" >"$out" 2>"$errf"
check "new-ticket refuses double-hyphen slug" 1 $?

# --- happy path: epic -> two stories -> tasks, cross-story dep ---
"$skill/scripts/new-ticket.sh" epic v1 "Ship v1" >"$out" 2>"$errf"
check "create epic" 0 $?
"$skill/scripts/new-ticket.sh" story net-firewall "Network firewall" v1 >"$out" 2>"$errf"
check "create story 1" 0 $?
"$skill/scripts/new-ticket.sh" story cli-wiring "CLI wiring" v1 >"$out" 2>"$errf"
check "create story 2" 0 $?
"$skill/scripts/new-ticket.sh" task http-proxy "HTTP proxy" net-firewall >"$out" 2>"$errf"
check "create task 1" 0 $?
"$skill/scripts/new-ticket.sh" task wire-cli "Wire into CLI" cli-wiring >"$out" 2>"$errf"
check "create task 2 (other story)" 0 $?

grep -q 'aliases: \[http-proxy\]' .plan/tasks/01-http-proxy.md
check "template fills aliases with slug" 0 $?

# cross-story dep: wire-cli (story cli-wiring) depends on http-proxy (story net-firewall)
sed -i 's/^depends_on: \[\]/depends_on: [http-proxy]/' .plan/tasks/02-wire-cli.md
cat >> .plan/tasks/02-wire-cli.md <<'EOF'

Extra context: builds on [[http-proxy|the proxy task]] under [[net-firewall]].
EOF

"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint clean backlog (cross-story dep, valid links)" 0 $?
if [[ -s "$out" ]]; then fail=$((fail+1)); echo "FAIL: lint not silent on clean backlog:"; cat "$out";
else pass=$((pass+1)); echo "PASS: lint silent on clean backlog"; fi

git add .plan && git commit -qm "backlog"

# --- ref mode ---
"$skill/scripts/lint.sh" main >"$out" 2>&1
check "lint ref mode (main) clean" 0 $?

# --- claim: cross-story dep gates ---
"$skill/scripts/claim.sh" wire-cli ../wt-wire-cli >"$out" 2>"$errf"
check "claim refused while cross-story dep not done" 1 $?
contains "  ...naming the blocker" "http-proxy(todo)" "$errf"

sed -i 's/^status: todo/status: done/' .plan/tasks/01-http-proxy.md
git add .plan && git commit -qm "http-proxy done"
"$skill/scripts/claim.sh" wire-cli ../wt-wire-cli >"$out" 2>"$errf"
check "claim succeeds once cross-story dep done" 0 $?
contains "  ...prints worktree path" "wt-wire-cli" "$out"
git worktree remove --force ../wt-wire-cli 2>/dev/null
git branch -qD plan/wire-cli 2>/dev/null

# --- lint error classes (working tree edits, not committed) ---
sed -i 's/^depends_on: \[http-proxy\]/depends_on: [ghost-task]/' .plan/tasks/02-wire-cli.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint errors on dangling depends_on" 1 $?
contains "  ...names the ghost" "depends_on 'ghost-task' does not exist" "$out"
sed -i 's/^depends_on: \[ghost-task\]/depends_on: [http-proxy]/' .plan/tasks/02-wire-cli.md

# Block-style depends_on parses as empty in lint.sh AND claim.sh — the dep
# would silently stop gating, so lint must error even though the dep exists.
sed -i 's/^depends_on: \[http-proxy\]/depends_on:\n  - http-proxy/' .plan/tasks/02-wire-cli.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint errors on block-style depends_on" 1 $?
contains "  ...saying gating would be disabled" "silently disable gating" "$out"
sed -i -e '/^  - http-proxy$/d' -e 's/^depends_on:$/depends_on: [http-proxy]/' .plan/tasks/02-wire-cli.md

sed -i 's/^depends_on: \[\]/depends_on: [wire-cli]/' .plan/tasks/01-http-proxy.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint errors on dependency cycle" 1 $?
contains "  ...prints the cycle" "depends_on cycle" "$out"
sed -i 's/^depends_on: \[wire-cli\]/depends_on: []/' .plan/tasks/01-http-proxy.md

# Self-dependency: pass 2 reports it; pass 3 must NOT also print a cycle.
sed -i 's/^depends_on: \[\]/depends_on: [http-proxy]/' .plan/tasks/01-http-proxy.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint errors on self-dependency" 1 $?
contains "  ...says depends_on itself" "depends_on itself" "$out"
if ! grep -qF "depends_on cycle" "$out"; then pass=$((pass+1)); echo "PASS: self-dep reported once, not as a cycle";
else fail=$((fail+1)); echo "FAIL: self-dep double-reported as cycle"; cat "$out"; fi
sed -i 's/^depends_on: \[http-proxy\]/depends_on: []/' .plan/tasks/01-http-proxy.md

sed -i 's/^parent: cli-wiring/parent: gone-story/' .plan/tasks/02-wire-cli.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint errors on dangling parent" 1 $?
contains "  ...says orphaned" "parent 'gone-story' does not exist" "$out"
sed -i 's/^parent: gone-story/parent: cli-wiring/' .plan/tasks/02-wire-cli.md

sed -i 's/^parent: cli-wiring/parent: http-proxy/' .plan/tasks/02-wire-cli.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "wrong-kind parent is only a warning (exit 0)" 0 $?
contains "  ...warns" "usually a story" "$out"
sed -i 's/^parent: http-proxy/parent: cli-wiring/' .plan/tasks/02-wire-cli.md

cp .plan/tasks/01-http-proxy.md .plan/tasks/03-http-proxy.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint errors on duplicate slug" 1 $?
contains "  ...says duplicate" "duplicate slug 'http-proxy'" "$out"
rm .plan/tasks/03-http-proxy.md

echo 'See [[no-such-note]] for background.' >> .plan/stories/01-net-firewall.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "unknown [[link]] is only a warning (exit 0)" 0 $?
contains "  ...mentions the link" "[[no-such-note]] matches no ticket slug" "$out"
git checkout -q .plan/stories/01-net-firewall.md

sed -i 's/^status: done/status: finished/' .plan/tasks/01-http-proxy.md
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint errors on invalid status" 1 $?
sed -i 's/^status: finished/status: done/' .plan/tasks/01-http-proxy.md

# --- new-ticket runs lint informationally: create a dangling dep first ---
sed -i 's/^depends_on: \[http-proxy\]/depends_on: [ghost-task]/' .plan/tasks/02-wire-cli.md
"$skill/scripts/new-ticket.sh" task another "Another" net-firewall >"$out" 2>"$errf"
check "new-ticket still succeeds with pre-existing lint errors" 0 $?
contains "  ...but surfaces them on stderr" "ghost-task" "$errf"
contains "  ...and stdout stays just the path" ".plan/tasks/03-another.md" "$out"
if [[ $(wc -l <"$out") -eq 1 ]]; then pass=$((pass+1)); echo "PASS: stdout is exactly one line";
else fail=$((fail+1)); echo "FAIL: stdout polluted"; cat "$out"; fi

# --- concurrent prefix allocation: parallel new-ticket.sh must not collide ---
# Simulate an agent scaffolding a whole epic in one parallel tool block: fire
# N new-ticket.sh invocations at once. Without the flock they'd all read the
# same `ls` and all compute NN=03, producing three 03-<slug>.md files. With
# the exclusive lock they serialize to 03,04,05. (Separate stdout/stderr so
# the informational lint on stderr doesn't pollute the one-line path check.)
sed -i 's/^depends_on: \[ghost-task\]/depends_on: [http-proxy]/' .plan/tasks/02-wire-cli.md
git checkout -q .plan/tasks/03-another.md 2>/dev/null || rm -f .plan/tasks/03-another.md

pids=()
"$skill/scripts/new-ticket.sh" task para-a "Parallel A" net-firewall >"$root/a.out" 2>"$root/a.err" &
pids+=($!)
"$skill/scripts/new-ticket.sh" task para-b "Parallel B" net-firewall >"$root/b.out" 2>"$root/b.err" &
pids+=($!)
"$skill/scripts/new-ticket.sh" task para-c "Parallel C" net-firewall >"$root/c.out" 2>"$root/c.err" &
pids+=($!)
rc=0
for p in "${pids[@]}"; do wait "$p" || rc=1; done
check "all 3 parallel new-ticket calls exited 0" 0 $rc

# Each stdout must be exactly one path line (the defensive post-write check
# runs inside each, so a false-positive there would make an exit non-zero or
# swallow the echo — caught above and here).
bad=0
for o in "$root/a.out" "$root/b.out" "$root/c.out"; do
  [[ $(wc -l <"$o") -eq 1 ]] || bad=1
done
check "each parallel stdout is exactly one line" 0 $bad

# The three new task prefixes must be distinct (no collision). They land in
# {03,04,05} in some order — the lock serializes allocation.
new_prefixes=$(ls .plan/tasks | grep -oE '^[0-9]+-para-[abc]' | grep -oE '^[0-9]+' | sort -u)
count=$(printf '%s\n' "$new_prefixes" | grep -c . || true)
if [[ "$count" -eq 3 ]]; then pass=$((pass+1)); echo "PASS: parallel prefixes are 3 distinct values";
else fail=$((fail+1)); echo "FAIL: parallel prefixes collided ($count distinct): $(tr '\n' ' ' <<<"$new_prefixes")"; ls .plan/tasks; fi

# The newly created tickets must pass lint (valid frontmatter, no dup slugs).
"$skill/scripts/lint.sh" >"$out" 2>&1
check "lint clean after parallel batch" 0 $?

# --- board.sh summary stats ---
"$skill/scripts/board.sh" >"$out" 2>&1
check "board.sh exits 0" 0 $?
contains "  ...has ## summary section" "## summary" "$out"
# Backlog: 1 epic (todo), 2 stories (todo), 2 tasks (1 done, 1 todo) —
# the parallel-created tasks exist on disk but are not committed to trunk.
# Parallells are not committed so board.sh (reads trunk) only sees 5 tickets.
board_summary=$(sed -n '/^## summary$/,/^## /{/^## summary$/d;/^STATUS/d;/^$/d;p}' "$out" | head -6)
if [[ "$(echo "$board_summary" | grep -c . || true)" -eq 6 ]]; then
  pass=$((pass+1)); echo "PASS: board summary has 6 status rows"
else
  fail=$((fail+1)); echo "FAIL: board summary should have 6 status rows, got:"; echo "$board_summary"
fi
if echo "$board_summary" | grep -qE '^total[[:space:]]+5$'; then
  pass=$((pass+1)); echo "PASS: board summary total = 5"
else
  fail=$((fail+1)); echo "FAIL: board summary total expected 5, got:"; echo "$board_summary" | grep '^total'
fi
if echo "$board_summary" | grep -qE '^done[[:space:]]+1$'; then
  pass=$((pass+1)); echo "PASS: board summary done = 1"
else
  fail=$((fail+1)); echo "FAIL: board summary done expected 1, got:"; echo "$board_summary" | grep '^done'
fi

echo
echo "=== $pass passed, $fail failed ==="
if [[ $fail -eq 0 ]]; then
  if [[ $keep -eq 0 ]]; then rm -rf "$root"; else echo "sandbox kept at $root"; fi
  exit 0
fi
echo "sandbox kept for inspection at $root"
exit 1
