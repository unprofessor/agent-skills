#!/usr/bin/env python3
"""Validate a skill directory's SKILL.md before publishing it to a tap.

Checks the same constraints the hermes publish path and skill_manager_tool
enforce: frontmatter present at byte 0, name + description present, description
<= 1024 chars, total file <= 100,000 chars.

Usage: python3 validate_skill.py <skill-dir>
Exit 0 = OK, 1 = failures.
"""
import pathlib
import re
import sys

try:
    import yaml
except ImportError:
    yaml = None


def main() -> int:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    skill_md = path / "SKILL.md"
    if not skill_md.exists():
        print(f"FAIL: no SKILL.md at {path}")
        return 1

    content = skill_md.read_text(encoding="utf-8").lstrip("\ufeff")
    errors = []

    if not content.startswith("---"):
        errors.append("frontmatter must start with '---' at byte 0")

    if yaml is None:
        print("WARN: pyyaml not installed — skipping frontmatter parse")
    else:
        m = re.search(r"\n---\s*\n", content[3:])
        if not m:
            errors.append("no closing '---' after frontmatter")
        else:
            fm = yaml.safe_load(content[3 : m.start() + 3]) or {}
            if not isinstance(fm, dict):
                errors.append("frontmatter is not a YAML mapping")
            else:
                if "name" not in fm:
                    errors.append("missing 'name' in frontmatter")
                desc = fm.get("description", "")
                if not desc:
                    errors.append("missing 'description' in frontmatter")
                elif len(desc) > 1024:
                    errors.append(f"description is {len(desc)} chars (> 1024)")

    if len(content) > 100_000:
        errors.append(f"SKILL.md is {len(content)} chars (> 100,000)")

    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1

    print("OK: frontmatter + size limits pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
