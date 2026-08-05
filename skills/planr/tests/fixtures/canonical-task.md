---
id: http-connect-proxy
aliases: [http-connect-proxy]
kind: task
parent: network-firewall
title: HTTP CONNECT allowlist proxy
status: review
assignee: null
created: 2026-07-30
updated: 2026-07-30
tags: [proxy, firewall]
depends_on: [parse-foundation, cli-scaffolding]
---

## Goal

Build the HTTP CONNECT allowlist proxy.

## Acceptance

- [ ] Block non-allowlisted hosts
- [ ] Log all connections

## Validation

Ran 50 test cases against the allowlist.

## Review

verdict: approved

## Notes

Linked from [[port-scripts]] and [[network-firewall]].
