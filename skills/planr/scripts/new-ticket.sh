#!/usr/bin/env bash
# Scaffold a new ticket file from a template. Run on trunk (leader only).
#
# Usage: new-ticket.sh <kind> <slug> <title> [parent-slug]
# Env:   PLANR_DIR (default .plan)
#
# Writes <planr>/<kind-plural>/<NN>-<slug>.md with frontmatter filled and
# prints the path. The caller then fills the body and commits. The parent slug
# is required for stories and tasks (and must already exist); ignored for
# epics. Runs lint.sh afterwards, informationally, on stderr.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
. "$here/_lock.sh"

kind="${1:?kind required: epic|story|task}"
slug="${2:?slug required}"
title="${3:?title required}"
parent="${4:-}"

plan="${PLANR_DIR:-.plan}"
case "$kind" in
  epic)  subdir="epics" ;;
  story) subdir="stories" ;;
  task)  subdir="tasks" ;;
  *) echo "unknown kind: $kind (want epic|story|task)" >&2; exit 1 ;;
esac

# Slugs are identity: every script greps for them, and [[wiki-links]] target
# them, so keep them to kebab-case.
if [[ ! "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "bad slug '$slug': want kebab-case (lowercase alphanumerics, single hyphens between segments, starting with [a-z0-9])" >&2
  exit 1
fi

if [[ "$kind" != "epic" && -z "$parent" ]]; then
  echo "parent slug required for $kind" >&2
  exit 1
fi

# The parent must already exist (any kind) — a dangling parent orphans the
# child, since roll-up is derived by scanning children for their parent slug.
if [[ -n "$parent" && "$kind" != "epic" ]]; then
  found=""
  for kd in epics stories tasks; do
    if ls "$plan/$kd" 2>/dev/null | grep -qE "^[0-9]+-${parent}\.md$"; then
      found=1
      break
    fi
  done
  if [[ -z "$found" ]]; then
    echo "parent '$parent' not found under $plan/ — create the parent first" >&2
    exit 1
  fi
fi

dir="$plan/$subdir"
mkdir -p "$dir"

template="$here/../templates/${kind}.md"
date="$(date +%F)"

# Escape a string for use in a perl s||| replacement: backslash, $, @, and the
# delimiter | are special and must be backslash-escaped.
repl_escape() { printf '%s' "$1" | perl -pe 's/([\\$@|])/\\$1/g'; }

slug_e=$(repl_escape "$slug")
title_e=$(repl_escape "$title")
parent_e=$(repl_escape "$parent")

# Prefix allocation is a read-modify-write on $dir. Serialize it across
# concurrent new-ticket.sh invocations — an agent scaffolding a whole epic
# will fire several in one parallel tool block, and without a lock each sees
# the same `ls` and computes the same NN, producing colliding sort-hints
# (different slugs, so the [[ -e ]] guard never trips). The exclusive lock
# makes allocate-and-create atomic.
planr_lock_exclusive

last=$(ls "$dir" 2>/dev/null | grep -oE '^[0-9]+' | sort -n | tail -1 || true)
nn=$(printf '%02d' $((10#${last:-0} + 1)))
path="$dir/${nn}-${slug}.md"

[[ -e "$path" ]] && { echo "already exists: $path" >&2; exit 1; }

# Copy first, then edit only the destination (never the template).
cp "$template" "$path"
perl -i -pe "
  s|__SLUG__|$slug_e|g;
  s|__TITLE__|$title_e|g;
  s|__PARENT__|$parent_e|g;
  s|__DATE__|$date|g;
" "$path"

# Defensive: the lock makes a prefix collision impossible, but a manual edit
# or a future regression that bypasses the lock could still land two files on
# the same NN. Re-scan and bail loudly rather than ship a colliding sort-hint.
collide=$(ls "$dir" | grep -cE "^${nn}-" || true)
if [[ "$collide" -ne 1 ]]; then
  echo "internal error: prefix ${nn} is shared by ${collide} files in ${dir} after creating ${path}" >&2
  exit 1
fi

# Release the exclusive lock before the informational lint so lint can take
# its own shared lock (no self-deadlock) and so we don't block other writers
# during a full backlog scan.
exec 9>&-

# Informational backlog-wide lint (dangling refs, cycles) on stderr. The new
# ticket itself is valid by construction; pre-existing issues don't block it.
"$here/lint.sh" >&2 || true

echo "$path"
