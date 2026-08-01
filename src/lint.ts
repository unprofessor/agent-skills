import type { ParsedTicket } from "./ticket.js";

// ---- types ----

export interface LintInput {
	file: string;
	ticket: ParsedTicket;
}

export interface LintIssue {
	file: string;
	level: "error" | "warning";
	message: string;
}

export interface LintReport {
	issues: LintIssue[];
	errorCount: number;
	warningCount: number;
}

// ---- pure lint logic (no fs, no git) ----

export function checkBacklog(inputs: LintInput[]): LintReport {
	const issues: LintIssue[] = [];

	// Indexes built in pass 1
	const fileOf = new Map<string, string>(); // id → file path
	const kindOf = new Map<string, string>(); // id → kind
	const parentOf = new Map<string, string | null>(); // id → parent
	const depsOf = new Map<string, string[]>(); // id → depends_on
	const linksOf = new Map<string, string[]>(); // id → wiki-links

	// ---- pass 1: per-file checks (no cross-refs) ----
	for (const { file, ticket: t } of inputs) {
		// Determine expected kind from directory
		let dirKind = "";
		if (file.includes("/epics/")) dirKind = "epic";
		else if (file.includes("/stories/")) dirKind = "story";
		else if (file.includes("/tasks/")) dirKind = "task";

		// Extract slug from filename: strip NN- prefix and .md suffix
		const base = file.split("/").pop() ?? "";
		const fslug = base.replace(/\.md$/, "").replace(/^\d+-/, "");

		// Validate id matches filename slug
		if (!t.id) {
			issues.push({
				file,
				level: "error",
				message: `missing id in frontmatter`,
			});
		} else if (t.id !== fslug) {
			issues.push({
				file,
				level: "error",
				message: `id '${t.id}' does not match filename slug '${fslug}'`,
			});
		}

		// Validate kind matches directory
		if (dirKind && t.kind !== dirKind) {
			issues.push({
				file,
				level: "error",
				message: `kind '${t.kind || "<missing>"}' but the file lives in the ${dirKind}s directory`,
			});
		}

		// Validate status
		const validStatuses = ["todo", "in_progress", "review", "done", "blocked"];
		if (!validStatuses.includes(t.status)) {
			issues.push({
				file,
				level: "error",
				message: `invalid status '${t.status || "<missing>"}' (want todo|in_progress|review|done|blocked)`,
			});
		}

		// Duplicate slug check
		const id = t.id || fslug;
		if (fileOf.has(id)) {
			issues.push({
				file,
				level: "error",
				message: `duplicate slug '${id}' (also ${fileOf.get(id)}) — slugs are identity and must be unique across the backlog`,
			});
			continue; // skip indexing duplicates
		}

		fileOf.set(id, file);
		kindOf.set(id, t.kind);
		parentOf.set(id, t.parent);
		depsOf.set(id, t.depends_on);
		linksOf.set(id, t.links);
	}

	// ---- pass 2: cross-reference checks ----
	const sortedIds = [...fileOf.keys()].sort();
	for (const id of sortedIds) {
		const file = fileOf.get(id)!;
		const kind = kindOf.get(id)!;
		const parent = parentOf.get(id);

		// Parent checks
		if (kind === "epic") {
			if (parent && parent !== "null") {
				issues.push({
					file,
					level: "error",
					message: `epics must not have a parent (found '${parent}')`,
				});
			}
		} else {
			if (!parent || parent === "null") {
				issues.push({
					file,
					level: "error",
					message: `a ${kind} must name a parent slug`,
				});
			} else if (!fileOf.has(parent)) {
				issues.push({
					file,
					level: "error",
					message: `parent '${parent}' does not exist — roll-up is derived by scanning children, so this ${kind} would be orphaned`,
				});
			} else {
				const expected = kind === "story" ? "epic" : "story";
				if (kindOf.get(parent) !== expected) {
					issues.push({
						file,
						level: "warning",
						message: `parent '${parent}' is a ${kindOf.get(parent)} (a ${kind}'s parent is usually a ${expected})`,
					});
				}
			}
		}

		// Depends_on checks
		for (const d of depsOf.get(id) ?? []) {
			if (d === id) {
				issues.push({
					file,
					level: "error",
					message: `depends_on itself`,
				});
			} else if (!fileOf.has(d)) {
				issues.push({
					file,
					level: "error",
					message: `depends_on '${d}' does not exist — claim.sh could never be satisfied`,
				});
			}
		}

		// Wiki-link checks
		for (const l of linksOf.get(id) ?? []) {
			if (!fileOf.has(l)) {
				issues.push({
					file,
					level: "warning",
					message: `[[${l}]] matches no ticket slug (fine if it points at a non-ticket note)`,
				});
			}
		}
	}

	// ---- pass 3: cycle detection (DFS) ----
	const color = new Map<string, "w" | "g" | "b">(); // white, gray, black
	const stack: string[] = [];

	function visit(n: string): void {
		const c = color.get(n) ?? "w";
		if (c === "b") return;
		if (c === "g") {
			// Found a cycle — build the cycle path
			let started = false;
			const parts: string[] = [];
			for (const s of stack) {
				if (s === n) started = true;
				if (started) parts.push(s);
			}
			const cycle = parts.join(" -> ") + " -> " + n;
			issues.push({
				file: fileOf.get(n)!,
				level: "error",
				message: `depends_on cycle: ${cycle} — nothing in the cycle can ever be claimed`,
			});
			return;
		}

		color.set(n, "g");
		stack.push(n);
		for (const d of depsOf.get(n) ?? []) {
			// Self-dependency already reported in pass 2; skip to avoid
			// one-node "cycle" report.
			if (d === n) continue;
			if (fileOf.has(d)) visit(d);
		}
		color.set(n, "b");
		// Remove n from stack (it's the last element since we pushed it)
		stack.pop();
	}

	for (const id of sortedIds) {
		visit(id);
	}

	// Count errors and warnings
	const errorCount = issues.filter((i) => i.level === "error").length;
	const warningCount = issues.filter((i) => i.level === "warning").length;

	return { issues, errorCount, warningCount };
}
