---
id: wiki-links-test
kind: task
parent: parser-foundation
title: Wiki-link edge cases test
status: todo
depends_on: []
---

## Goal

Test that wiki-link extraction handles edge cases correctly.

Here is a link with an alias: [[port-scripts|the port story]].

Here is a link with a heading: [[network-firewall#acceptance]].

Here is a link with both: [[parse-foundation#goal|parser goal]].

Here is a normal link: [[cli-scaffolding]].

Now a fenced code block — the link inside must NOT be extracted:

```
Some code with [[should-not-appear]] inside a fence.
```

Another fence variant:

~~~md
[[also-should-not-appear]]
~~~

After the fence: [[port-scripts]] (this one should be extracted,
and since it was already seen with an alias, it deduplicates).

## Review

verdict: approved
