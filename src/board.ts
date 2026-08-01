import type { ParsedTicket } from "./ticket.js";

// ---- types ----

export interface BranchStatus {
	branch: string;
	status: string; // status on the branch
	slug: string; // task slug (branch sans plan/)
}

export interface BoardInput {
	/** All trunk tickets (epics, stories, tasks) from .plan/ */
	trunkTickets: ParsedTicket[];
	/** In-flight branch statuses from plan/* branches */
	branchStatuses: BranchStatus[];
}

// ---- helpers ----

/** Build a lookup map: slug → status (from trunk tickets, all kinds). */
function trunkStatusMap(tickets: ParsedTicket[]): Map<string, string> {
	const m = new Map<string, string>();
	for (const t of tickets) {
		m.set(t.id, t.status);
	}
	return m;
}

/** Compute BLOCKED-BY for a task: slugs of unmet depends_on. */
function blockedBy(task: ParsedTicket, statusMap: Map<string, string>): string {
	if (!task.depends_on || task.depends_on.length === 0) return "";
	const unmet: string[] = [];
	for (const dep of task.depends_on) {
		const st = statusMap.get(dep);
		if (st !== "done") unmet.push(dep);
	}
	return unmet.join(" ");
}

function pad(s: string, width: number): string {
	if (s.length >= width) return s;
	return s + " ".repeat(width - s.length);
}

function padRight(s: string, width: number): string {
	return pad(s, width);
}

// ---- rendering ----

function renderSection(
	label: string,
	tickets: ParsedTicket[],
	statusMap: Map<string, string>,
	isTasks: boolean,
): string {
	if (tickets.length === 0) return "";

	let out = `## ${label}\n`;
	out += `${padRight("ID", 30)} ${padRight("STATUS", 12)} ${padRight("PARENT", 22)} ${padRight("BLOCKED-BY", 22)} ${"TITLE"}\n`;

	for (const t of tickets) {
		const blocked = isTasks ? blockedBy(t, statusMap) : "";
		out += `${padRight(t.id, 30)} ${padRight(t.status, 12)} ${padRight(t.parent ?? "-", 22)} ${padRight(blocked || " -", 22)} ${t.title}\n`;
	}
	out += "\n";
	return out;
}

function renderInFlight(branches: BranchStatus[]): string {
	if (branches.length === 0) return "";

	let out = "## in flight (worktree branches)\n";
	out += `${padRight("BRANCH", 30)} ${padRight("STATUS", 14)} ${"TASK"}\n`;

	for (const b of branches) {
		out += `${padRight(b.branch, 30)} ${padRight(b.status, 14)} ${b.slug}\n`;
	}
	out += "\n";
	return out;
}

function renderSummary(
	trunkTickets: ParsedTicket[],
	branches: BranchStatus[],
	statusMap: Map<string, string>,
): string {
	const inFlightSlugs = new Set(branches.map((b) => b.slug));

	let tTodo = 0;
	let tIp = 0;
	let tReview = 0;
	let tDone = 0;
	let tBlocked = 0;

	for (const t of trunkTickets) {
		// Skip trunk entry if there's an in-flight branch for this slug (only for tasks)
		if (t.kind === "task" && inFlightSlugs.has(t.id)) continue;

		// Check if a non-done task is blocked
		if (t.kind === "task" && t.status !== "done") {
			const unmet = blockedBy(t, statusMap);
			if (unmet) {
				tBlocked++;
				continue;
			}
		}

		switch (t.status) {
			case "todo":
				tTodo++;
				break;
			case "in_progress":
				tIp++;
				break;
			case "review":
				tReview++;
				break;
			case "done":
				tDone++;
				break;
			case "blocked":
				tBlocked++;
				break;
		}
	}

	// Count in-flight branch statuses
	for (const b of branches) {
		switch (b.status) {
			case "todo":
				tTodo++;
				break;
			case "in_progress":
				tIp++;
				break;
			case "review":
				tReview++;
				break;
			case "done":
				tDone++;
				break;
			case "blocked":
				tBlocked++;
				break;
		}
	}

	const total = tTodo + tIp + tReview + tDone + tBlocked;

	let out = "## summary\n";
	out += `${padRight("STATUS", 12)} ${"COUNT"}\n`;
	out += `${padRight("total", 12)} ${total}\n`;
	out += `${padRight("todo", 12)} ${tTodo}\n`;
	out += `${padRight("in_progress", 12)} ${tIp}\n`;
	out += `${padRight("review", 12)} ${tReview}\n`;
	out += `${padRight("done", 12)} ${tDone}\n`;
	out += `${padRight("blocked", 12)} ${tBlocked}\n`;

	return out;
}

/**
 * Render the full board view: epics, stories, tasks, in-flight, summary.
 * Pure function — no I/O.
 */
export function renderBoard(input: BoardInput): string {
	const { trunkTickets, branchStatuses } = input;
	const statusMap = trunkStatusMap(trunkTickets);

	const epics = trunkTickets.filter((t) => t.kind === "epic");
	const stories = trunkTickets.filter((t) => t.kind === "story");
	const tasks = trunkTickets.filter((t) => t.kind === "task");

	let out = "";
	out += renderSection("epics", epics, statusMap, false);
	out += renderSection("stories", stories, statusMap, false);
	out += renderSection("tasks", tasks, statusMap, true);
	out += renderInFlight(branchStatuses);
	out += renderSummary(trunkTickets, branchStatuses, statusMap);

	return out;
}
