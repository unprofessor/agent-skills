#!/usr/bin/env bash
# Derive a read-only board view from trunk + in-flight branches.
# No checkout required; reads via git show / git branch.
#
# Usage: board.sh [trunk]
# Env:   PLANR_TRUNK (default main), PLANR_DIR (default .plan)
#
# Prints, in order: epics, stories, tasks (from trunk, with BLOCKED-BY for
# tasks whose depends_on are not all done), then an "in flight" section
# scanning plan/* branches for per-task status (so review-ready work shows
# before merge).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
. "$here/_lock.sh"
planr_lock_shared

trunk="${1:-${PLANR_TRUNK:-main}}"
plan="${PLANR_DIR:-.plan}"

fm_field() {
  awk -v k="$1" '
    /^---$/ { f = !f; next }
    f && $0 ~ "^" k ":" {
      sub("^" k ":[[:space:]]*", "")
      print
      exit
    }
  '
}

# Parse a YAML inline list value like "depends_on: [a, b]" -> one slug per line.
fm_list() {
  awk -v k="$1" '
    /^---$/ { f = !f; next }
    f && $0 ~ "^" k ":" {
      sub("^" k ":[[:space:]]*", "")
      gsub(/^\[|\]$/, "")
      gsub(/[[:space:]]/, "")
      n = split($0, a, ",")
      for (i = 1; i <= n; i++) if (a[i] != "") print a[i]
      exit
    }
  '
}

git rev-parse --verify -q "$trunk" >/dev/null || {
  echo "no such branch: $trunk" >&2
  exit 1
}

# Print the status of a ticket slug on trunk, searching all kinds.
trunk_status() {
  local slug="$1"
  for d in epics stories tasks; do
    local f
    f=$(git ls-tree -r --name-only "$trunk" -- "$plan/$d" 2>/dev/null \
        | grep -E -- "/[0-9]+-${slug}\.md$" | head -n1 || true)
    [[ -n "$f" ]] && { git show "$trunk:$f" | fm_field status; return; }
  done
}

render_section() {
  local label="$1" dir="$2"
  local paths
  paths=$(git ls-tree -r --name-only "$trunk" -- "$dir" 2>/dev/null | grep -E '\.md$' || true)
  [[ -z "$paths" ]] && return
  echo "## $label"
  printf '%-30s %-12s %-22s %-22s %s\n' ID STATUS PARENT BLOCKED-BY TITLE
  while IFS= read -r p; do
    local blob id st pa ti deps blocked d ds
    blob=$(git show "$trunk:$p")
    id=$(printf '%s' "$blob" | fm_field id)
    st=$(printf '%s' "$blob" | fm_field status)
    pa=$(printf '%s' "$blob" | fm_field parent)
    ti=$(printf '%s' "$blob" | fm_field title)
    blocked=""
    if [[ "$label" == "tasks" ]]; then
      deps=$(printf '%s' "$blob" | fm_list depends_on)
      if [[ -n "$deps" ]]; then
        for d in $deps; do
          ds=$(trunk_status "$d")
          [[ "$ds" != "done" ]] && blocked="${blocked} ${d}"
        done
      fi
    fi
    printf '%-30s %-12s %-22s %-22s %s\n' "$id" "$st" "${pa:--}" "${blocked:- -}" "$ti"
  done <<< "$paths"
  echo
}

for entry in "epics:$plan/epics" "stories:$plan/stories" "tasks:$plan/tasks"; do
  label="${entry%%:*}"; dir="${entry#*:}"
  render_section "$label" "$dir"
done

# In flight: scan plan/* branches for the task's status on that branch.
inflight=$(git branch --list 'plan/*' 2>/dev/null | sed 's/^[*+ ]*//' || true)
if [[ -n "$inflight" ]]; then
  echo "## in flight (worktree branches)"
  printf '%-30s %-14s %s\n' BRANCH STATUS TASK
  while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    slug=${b#plan/}
    f=$(git ls-tree -r --name-only "$b" -- "$plan/tasks" 2>/dev/null \
        | grep -E -- "/[0-9]+-${slug}\.md$" | head -n1 || true)
    if [[ -n "$f" ]]; then
      st=$(git show "$b:$f" | fm_field status)
    else
      st="(no task file)"
    fi
    printf '%-30s %-14s %s\n' "$b" "$st" "$slug"
  done <<< "$inflight"
  echo
fi

# Summary: count tickets per status across trunk + in-flight branches.
# Reuses the same git operations board.sh already performs.
echo "## summary"
printf '%-12s %s\n' STATUS COUNT

# Build a set of in-flight slugs so we skip their trunk entries.
if_slugs=""
if [[ -n "$inflight" ]]; then
  while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    if_slugs="$if_slugs ${b#plan/}"
  done <<< "$inflight"
fi

t_todo=0; t_ip=0; t_review=0; t_done=0; t_blocked=0
for dir in epics stories tasks; do
  paths=$(git ls-tree -r --name-only "$trunk" -- "$plan/$dir" 2>/dev/null \
    | grep -E '\.md$' || true)
  [[ -z "$paths" ]] && continue
  while IFS= read -r p; do
    blob=$(git show "$trunk:$p")
    slug=$(printf '%s' "$blob" | fm_field id)
    st=$(printf '%s' "$blob" | fm_field status)
    [[ -z "$st" ]] && continue
    # Skip trunk entry if this slug has an in-flight branch (counted below)
    if [[ "$dir" == "tasks" ]]; then
      case " $if_slugs " in
        *" $slug "*) continue ;;
      esac
    fi
    # Check whether a non-done task is blocked by unmet depends_on
    if [[ "$dir" == "tasks" && "$st" != "done" ]]; then
      deps=$(printf '%s' "$blob" | fm_list depends_on)
      if [[ -n "$deps" ]]; then
        for d in $deps; do
          ds=$(trunk_status "$d")
          if [[ "$ds" != "done" ]]; then
            t_blocked=$((t_blocked + 1))
            st=""
            break
          fi
        done
      fi
    fi
    [[ -z "$st" ]] && continue
    case "$st" in
      todo) t_todo=$((t_todo + 1)) ;;
      in_progress) t_ip=$((t_ip + 1)) ;;
      review) t_review=$((t_review + 1)) ;;
      done) t_done=$((t_done + 1)) ;;
      blocked) t_blocked=$((t_blocked + 1)) ;;
    esac
  done <<< "$paths"
done

# Count in-flight branch statuses (their deps were verified at claim time)
if [[ -n "$inflight" ]]; then
  while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    slug=${b#plan/}
    f=$(git ls-tree -r --name-only "$b" -- "$plan/tasks" 2>/dev/null \
        | grep -E -- "/[0-9]+-${slug}\\.md$" | head -n1 || true)
    [[ -z "$f" ]] && continue
    st=$(git show "$b:$f" | fm_field status)
    [[ -z "$st" ]] && continue
    case "$st" in
      todo) t_todo=$((t_todo + 1)) ;;
      in_progress) t_ip=$((t_ip + 1)) ;;
      review) t_review=$((t_review + 1)) ;;
      done) t_done=$((t_done + 1)) ;;
      blocked) t_blocked=$((t_blocked + 1)) ;;
    esac
  done <<< "$inflight"
fi

t_total=$((t_todo + t_ip + t_review + t_done + t_blocked))
printf '%-12s %s\n' total "$t_total"
printf '%-12s %s\n' todo "$t_todo"
printf '%-12s %s\n' in_progress "$t_ip"
printf '%-12s %s\n' review "$t_review"
printf '%-12s %s\n' done "$t_done"
printf '%-12s %s\n' blocked "$t_blocked"
