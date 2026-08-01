#!/usr/bin/env bash
exec node "$(dirname "$0")/../skills/planr/dist/cli/new-ticket.cjs" "$@"
