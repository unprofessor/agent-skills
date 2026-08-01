---
id: multi-review-test
kind: task
parent: parser-foundation
title: Ticket with multiple review blocks
status: review
depends_on: []
---

## Goal

This fixture has multiple ## Review sections. The parser must return
the verdict from the LAST one.

## Review

verdict: changes-requested

## Notes

First review found issues.

## Review

verdict: approved

## Notes

Second review passed.
