import { describe, it, expect } from "vitest";
import {
  splitFrontmatter,
  parseFrontmatter,
  extractWikiLinks,
  extractSection,
  extractLastReviewVerdict,
} from "../src/parse.js";
import { parseTicket, Kind } from "../src/ticket.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures", name), "utf-8");

// ---- splitFrontmatter ----

describe("splitFrontmatter", () => {
  it("splits a canonical ticket into fm and body", () => {
    const blob = fixture("canonical-task.md");
    const { fm, body, raw } = splitFrontmatter(blob);
    expect(raw).toBe(blob);
    expect(fm).toContain("id: http-connect-proxy");
    expect(fm).toContain("depends_on: [parse-foundation, cli-scaffolding]");
    expect(body).toContain("## Goal");
    expect(body).toContain("## Notes");
    // Must NOT contain frontmatter lines
    expect(body).not.toContain("id: http-connect-proxy");
  });

  it("does NOT re-enter on body --- thematic break", () => {
    const blob = fixture("body-thematic-break.md");
    const { fm, body } = splitFrontmatter(blob);
    // fm must only have the real frontmatter
    expect(fm).toContain("id: thematic-break-test");
    expect(fm).not.toContain("fake-id");
    // Body must contain the thematic break and the fake-looking lines
    expect(body).toContain("---");
    expect(body).toContain("id: fake-id");
    expect(body).toContain("status: done");
  });

  it("returns empty fm and full blob as body when no frontmatter", () => {
    const blob = "# Just a markdown file\n\nNo frontmatter here.\n";
    const { fm, body, raw } = splitFrontmatter(blob);
    expect(fm).toBe("");
    expect(body).toBe(blob);
    expect(raw).toBe(blob);
  });

  it("handles frontmatter with no trailing body", () => {
    const blob = "---\nid: test\n---\n";
    const { fm, body } = splitFrontmatter(blob);
    expect(fm).toBe("id: test");
    expect(body).toBe("");
  });

  it("handles frontmatter with only opening ---", () => {
    const blob = "---\nid: test\n";
    const { fm, body } = splitFrontmatter(blob);
    // Malformed: no closing ---, so treat all as body
    expect(fm).toBe("");
    expect(body).toBe(blob);
  });
});

// ---- parseFrontmatter ----

describe("parseFrontmatter", () => {
  it("parses inline depends_on list", () => {
    const blob = fixture("canonical-task.md");
    const { fm } = splitFrontmatter(blob);
    const front = parseFrontmatter(fm);
    expect(front.id).toBe("http-connect-proxy");
    expect(front.kind).toBe("task");
    expect(front.status).toBe("review");
    expect(front.parent).toBe("network-firewall");
    expect(front.title).toBe("HTTP CONNECT allowlist proxy");
    expect(front.depends_on).toEqual(["parse-foundation", "cli-scaffolding"]);
  });

  it("parses block-style depends_on (Obsidian-reformatted)", () => {
    const blob = fixture("obsidian-reformatted.md");
    const { fm } = splitFrontmatter(blob);
    const front = parseFrontmatter(fm);
    expect(front.id).toBe("obsidian-task");
    // Block-style depends_on must parse to same array as inline
    expect(front.depends_on).toEqual(["parse-foundation", "cli-scaffolding"]);
    // Quoted status "done" must parse to the string "done" (not '"done"')
    expect(front.status).toBe("done");
    // Block-list aliases
    expect(front.aliases).toEqual(["obsidian-task"]);
  });

  it("returns empty object for empty frontmatter", () => {
    expect(parseFrontmatter("")).toEqual({});
    expect(parseFrontmatter("   \n")).toEqual({});
  });
});

// ---- extractWikiLinks ----

describe("extractWikiLinks", () => {
  it("extracts normal, aliased, and heading links, deduplicated", () => {
    const blob = fixture("wiki-links-edge-cases.md");
    const { body } = splitFrontmatter(blob);
    const links = extractWikiLinks(body);
    // port-scripts appears twice (once with alias, once plain) — deduped
    expect(links).toContain("port-scripts");
    expect(links).toContain("network-firewall");
    expect(links).toContain("parse-foundation");
    expect(links).toContain("cli-scaffolding");
    // port-scripts should appear only once
    expect(links.filter((l) => l === "port-scripts").length).toBe(1);
  });

  it("skips links inside fenced code blocks", () => {
    const blob = fixture("wiki-links-edge-cases.md");
    const { body } = splitFrontmatter(blob);
    const links = extractWikiLinks(body);
    expect(links).not.toContain("should-not-appear");
    expect(links).not.toContain("also-should-not-appear");
  });
});

// ---- extractSection ----

describe("extractSection", () => {
  it("extracts a named section", () => {
    const blob = fixture("canonical-task.md");
    const { body } = splitFrontmatter(blob);
    const goal = extractSection(body, "Goal");
    expect(goal).toBe("Build the HTTP CONNECT allowlist proxy.");
  });

  it("excludes the heading line", () => {
    const blob = fixture("canonical-task.md");
    const { body } = splitFrontmatter(blob);
    const acceptance = extractSection(body, "Acceptance");
    expect(acceptance).not.toContain("## Acceptance");
    expect(acceptance).toContain("- [ ] Block non-allowlisted hosts");
  });

  it("stops at the next ## heading", () => {
    const blob = fixture("canonical-task.md");
    const { body } = splitFrontmatter(blob);
    const acceptance = extractSection(body, "Acceptance");
    expect(acceptance).not.toContain("## Validation");
    expect(acceptance).not.toContain("Ran 50 test cases");
  });

  it("returns empty string for missing section", () => {
    const blob = fixture("canonical-task.md");
    const { body } = splitFrontmatter(blob);
    expect(extractSection(body, "Nonexistent")).toBe("");
  });
});

// ---- extractLastReviewVerdict ----

describe("extractLastReviewVerdict", () => {
  it("returns the verdict from the last ## Review block", () => {
    const blob = fixture("multiple-reviews.md");
    const { body } = splitFrontmatter(blob);
    const verdict = extractLastReviewVerdict(body);
    expect(verdict).toBe("approved");
  });

  it("returns null when no review block exists", () => {
    const verdict = extractLastReviewVerdict("## Goal\nNo review here.\n");
    expect(verdict).toBeNull();
  });

  it("trims whitespace from verdict value", () => {
    const body = "## Review\nverdict:   approved   \n";
    expect(extractLastReviewVerdict(body)).toBe("approved");
  });
});

// ---- parseTicket (integration) ----

describe("parseTicket", () => {
  it("produces a complete ParsedTicket from canonical input", () => {
    const blob = fixture("canonical-task.md");
    const ticket = parseTicket(blob);

    expect(ticket.id).toBe("http-connect-proxy");
    expect(ticket.kind).toBe(Kind.task);
    expect(ticket.status).toBe("review");
    expect(ticket.parent).toBe("network-firewall");
    expect(ticket.title).toBe("HTTP CONNECT allowlist proxy");
    expect(ticket.depends_on).toEqual(["parse-foundation", "cli-scaffolding"]);
    expect(ticket.aliases).toEqual(["http-connect-proxy"]);
    expect(ticket.links).toContain("port-scripts");
    expect(ticket.links).toContain("network-firewall");
    expect(ticket.raw).toBeTruthy();
  });

  it("parses Obsidian-reformatted ticket identically for key fields", () => {
    const blob = fixture("obsidian-reformatted.md");
    const ticket = parseTicket(blob);

    expect(ticket.id).toBe("obsidian-task");
    expect(ticket.status).toBe("done"); // quoted "done" → done
    expect(ticket.depends_on).toEqual(["parse-foundation", "cli-scaffolding"]);
    expect(ticket.aliases).toEqual(["obsidian-task"]);
  });

  it("does not re-enter frontmatter on body ---", () => {
    const blob = fixture("body-thematic-break.md");
    const ticket = parseTicket(blob);

    expect(ticket.id).toBe("thematic-break-test");
    expect(ticket.status).toBe("todo");
    // Must NOT pick up fake frontmatter from body
    expect(ticket.id).not.toBe("fake-id");
  });

  it("wiki-link in code fence is NOT extracted", () => {
    const blob = fixture("wiki-links-edge-cases.md");
    const ticket = parseTicket(blob);

    expect(ticket.links).not.toContain("should-not-appear");
    expect(ticket.links).not.toContain("also-should-not-appear");
    expect(ticket.links).toContain("port-scripts");
  });

  it("last review verdict wins", () => {
    // Use parseTicket + extractLastReviewVerdict together
    const blob = fixture("multiple-reviews.md");
    const { body } = splitFrontmatter(blob);
    expect(extractLastReviewVerdict(body)).toBe("approved");
  });
});
