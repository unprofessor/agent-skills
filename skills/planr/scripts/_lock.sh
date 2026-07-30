#!/usr/bin/env bash
# Shared flock helpers for planr scripts. Sourced (never run directly).
#
# The backlog lives in the working tree of $PLANR_DIR (default .plan) on
# trunk. Scripts coordinate concurrent access through a single flock on a
# lock file in the repo's common git dir:
#   - mutating scripts (new-ticket.sh, merge-task.sh) take an EXCLUSIVE lock;
#   - read-only scripts (board.sh, lint.sh in working-tree mode, review.sh,
#     claim.sh) take a SHARED lock, so they read a consistent snapshot and
#     don't race a writer's working-tree mutation.
#
# The lock file lives under `git rev-parse --git-common-dir` (not in $PLANR_DIR)
# so it is shared across worktrees of one repo and never appears in the
# working tree — no .gitignore needed and it is never committed.
#
# Each helper opens fd 9 on the lock file and blocks until the lock is held.
# The lock auto-releases when fd 9 closes (script exit, or an explicit
# `exec 9>&-`). Writers that invoke child scripts MUST `exec 9>&-` first so
# the child does not inherit (and self-deadlock against) the held lock.
#
# Requires `flock` (util-linux), standard on Linux.

command -v flock >/dev/null 2>&1 || {
  echo "planr: 'flock' (util-linux) is required for safe concurrent access to .plan" >&2
  exit 1
}

# Resolve the lock file path. Prefers the repo's common git dir so the lock is
# shared across worktrees and stays out of the working tree; falls back to
# $PLANR_DIR/.lock only outside a git repo (planr always runs inside one).
planr_lock_file() {
  local gd
  gd="$(git rev-parse --git-common-dir 2>/dev/null)" || gd=""
  if [[ -n "$gd" && -d "$gd" ]]; then
    printf '%s/planr.lock' "$gd"
  else
    printf '%s/.lock' "${PLANR_DIR:-.plan}"
  fi
}

# Exclusive (write) lock. Hold for the minimum critical section; release with
# `exec 9>&-` before invoking any child script.
planr_lock_exclusive() {
  local lf
  lf="$(planr_lock_file)"
  mkdir -p "$(dirname "$lf")"
  exec 9>"$lf"
  flock -x 9
}

# Shared (read) lock. Hold for the duration of the read; auto-releases on exit.
planr_lock_shared() {
  local lf
  lf="$(planr_lock_file)"
  mkdir -p "$(dirname "$lf")"
  exec 9>"$lf"
  flock -s 9
}
