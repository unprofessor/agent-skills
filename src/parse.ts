import { parse as yamlParse } from "yaml";

/**
 * Split a ticket blob into frontmatter (YAML between first pair of --- lines)
 * and body (everything after). Reads only the FIRST `---` block; a body `---`
 * thematic break does NOT re-enter frontmatter parsing.
 *
 * Returns `raw` (the original blob) alongside `fm` and `body`.
 */
export function splitFrontmatter(blob: string): {
  fm: string;
  body: string;
  raw: string;
} {
  const lines = blob.split("\n");
  // Must start with --- on its own line (trimmed)
  if (lines.length === 0 || lines[0].trimEnd() !== "---") {
    return { fm: "", body: blob, raw: blob };
  }

  // Find the closing --- (first --- after the opening, on its own line)
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === "---") {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    // Malformed: opening --- but no closing ---; treat all as body
    return { fm: "", body: blob, raw: blob };
  }

  const fm = lines.slice(1, closeIdx).join("\n");
  const body = lines.slice(closeIdx + 1).join("\n");
  return { fm, body, raw: blob };
}

/**
 * Parse frontmatter YAML into a plain object. Uses eemeli/yaml which handles
 * both inline `[a, b]` and block-style YAML lists correctly.
 */
export function parseFrontmatter(fm: string): Record<string, unknown> {
  if (!fm.trim()) return {};
  const parsed = yamlParse(fm);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

/**
 * Extract wiki-links from body text. Matches `[[slug]]`, `[[slug|alias]]`,
 * and `[[slug#heading]]` — stripping alias/heading, skipping fenced code
 * blocks, and deduplicating results.
 *
 * Regex breakdown:
 *   \[\[           literal [[
 *   ([^\]|#]+)    capture group 1: slug (no ], |, or #)
 *   (?:#[^\]]*)?  optional #heading (non-capturing)
 *   (?:\|[^\]]*)? optional |alias  (non-capturing)
 *   \]\]           literal ]]
 */
export function extractWikiLinks(body: string): string[] {
  const linkRe = /\[\[([^\]|#]+)(?:#[^\]]*)?(?:\|[^\]]*)?\]\]/g;
  const seen = new Set<string>();
  const result: string[] = [];

  // Remove fenced code blocks before scanning (both backtick and tilde)
  const withoutFences = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "");

  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(withoutFences)) !== null) {
    const slug = match[1];
    if (!seen.has(slug)) {
      seen.add(slug);
      result.push(slug);
    }
  }

  return result;
}

/**
 * Extract the content of a named `## Section` from body text. Uses a state
 * machine on `^## ` lines; returns lines from the heading until the next `^## `
 * heading, excluding the heading line itself.
 */
export function extractSection(body: string, name: string): string {
  const lines = body.split("\n");
  const heading = `## ${name}`;
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    // Detect any ## heading
    if (/^## /.test(line)) {
      if (inSection) {
        // Next heading — stop collecting
        break;
      }
      if (line === heading) {
        inSection = true;
        // Do NOT include the heading line itself
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  // Trim leading and trailing blank lines from the section
  while (
    sectionLines.length > 0 &&
    sectionLines[sectionLines.length - 1] === ""
  ) {
    sectionLines.pop();
  }
  while (
    sectionLines.length > 0 &&
    sectionLines[0] === ""
  ) {
    sectionLines.shift();
  }

  return sectionLines.join("\n");
}

/**
 * Extract the verdict from the **last** `## Review` block in the body.
 * Returns the trimmed value after `verdict:` or null if no review block exists.
 *
 * Multiple `## Review` sections may exist (re-reviews); the last one wins.
 */
export function extractLastReviewVerdict(body: string): string | null {
  const lines = body.split("\n");
  let inReview = false;
  let lastVerdict: string | null = null;

  for (const line of lines) {
    if (/^## /.test(line)) {
      inReview = line === "## Review";
      continue;
    }
    if (inReview && /^verdict:\s*\S/.test(line)) {
      lastVerdict = line.replace(/^verdict:\s*/, "").trim();
    }
  }

  return lastVerdict;
}
