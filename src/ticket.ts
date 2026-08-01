import {
  splitFrontmatter,
  parseFrontmatter,
  extractWikiLinks,
  extractSection,
  extractLastReviewVerdict,
} from "./parse.js";

// ---- Kind: const object + union type (NOT enum) ----

export const Kind = {
  epic: "epic",
  story: "story",
  task: "task",
} as const;

export type Kind = (typeof Kind)[keyof typeof Kind];

// ---- Status: union of known status strings ----

export type Status = "todo" | "in_progress" | "review" | "done";

// ---- ParsedTicket: the typed shape every script consumes ----

export interface ParsedTicket {
  id: string;
  kind: Kind;
  status: Status;
  parent: string | null;
  title: string;
  depends_on: string[];
  aliases: string[];
  links: string[];
  raw: string;
}

/**
 * Parse a complete ticket blob (frontmatter + body) into a typed
 * `ParsedTicket`. This is the single entry point scripts will call.
 */
export function parseTicket(blob: string): ParsedTicket {
  const { fm, body } = splitFrontmatter(blob);
  const front = parseFrontmatter(fm);

  // Extract scalars with correct types
  const id = String(front.id ?? "");
  const kind = String(front.kind ?? "") as Kind;
  const status = String(front.status ?? "todo") as Status;
  const parent = front.parent != null ? String(front.parent) : null;
  const title = String(front.title ?? "");

  // depends_on: handle both inline [a,b] (parsed as array) and block-style
  // YAML list. Also handle the case where it's a single string (common edge
  // case when only one dep).
  let depends_on: string[] = [];
  const rawDeps = front.depends_on;
  if (Array.isArray(rawDeps)) {
    depends_on = rawDeps.map((d) => String(d));
  } else if (typeof rawDeps === "string" && rawDeps.trim()) {
    depends_on = [rawDeps.trim()];
  } else if (rawDeps != null) {
    depends_on = [String(rawDeps)];
  }

  // aliases: YAML list (or inline array)
  let aliases: string[] = [];
  const rawAliases = front.aliases;
  if (Array.isArray(rawAliases)) {
    aliases = rawAliases.map((a) => String(a));
  } else if (typeof rawAliases === "string" && rawAliases.trim()) {
    aliases = [rawAliases.trim()];
  } else if (rawAliases != null) {
    aliases = [String(rawAliases)];
  }

  const links = extractWikiLinks(body);

  return {
    id,
    kind,
    status,
    parent,
    title,
    depends_on,
    aliases,
    links,
    raw: body,
  };
}
