---
id: thematic-break-test
kind: task
parent: parser-foundation
title: Body contains --- thematic break
status: todo
depends_on: []
---

## Goal

This is a test fixture. The body below contains a `---` thematic break.

---

The line above is a thematic break (horizontal rule in markdown).
It must NOT cause the parser to re-enter frontmatter mode.

If the parser re-enters, it would see this line as `id: fake-id` and
overwrite the real ticket id.

id: fake-id
status: done

This text is part of the body, not frontmatter.

## Review

verdict: approved
