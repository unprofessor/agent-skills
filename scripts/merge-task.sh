#!/usr/bin/env bash
exec node "$(dirname "$0")/../dist/cli/merge-task.cjs" "$@"
