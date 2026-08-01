import { describe, it, expect } from "vitest";
import { renderBoard } from "../src/board.js";
import type { BoardInput, BranchStatus } from "../src/board.js";
import type { ParsedTicket } from "../src/ticket.js";

function t(
	opts: Partial<ParsedTicket> & { id: string; kind: string },
): ParsedTicket {
	return {
		id: opts.id,
		kind: opts.kind as ParsedTicket["kind"],
		status: opts.status ?? "todo",
		parent: opts.parent ?? null,
		title: opts.title ?? "Test ticket",
		depends_on: opts.depends_on ?? [],
		aliases: opts.aliases ?? [],
		links: opts.links ?? [],
		raw: opts.raw ?? "",
	};
}

describe("renderBoard", () => {
	it("renders empty board with no tickets", () => {
		const input: BoardInput = { trunkTickets: [], branchStatuses: [] };
		const output = renderBoard(input);
		// Only summary section
		expect(output).toContain("## summary");
		expect(output).toContain("total");
	});

	it("renders epic, story, and task sections", () => {
		const tickets: ParsedTicket[] = [
			t({ id: "v1", kind: "epic", title: "Ship v1" }),
			t({ id: "net", kind: "story", parent: "v1", title: "Network" }),
			t({
				id: "proxy",
				kind: "task",
				parent: "net",
				title: "HTTP proxy",
			}),
		];
		const input: BoardInput = { trunkTickets: tickets, branchStatuses: [] };
		const output = renderBoard(input);

		expect(output).toContain("## epics");
		expect(output).toContain("v1");
		expect(output).toContain("Ship v1");

		expect(output).toContain("## stories");
		expect(output).toContain("net");
		expect(output).toContain("Network");
		expect(output).toContain("v1"); // parent column

		expect(output).toContain("## tasks");
		expect(output).toContain("proxy");
		expect(output).toContain("HTTP proxy");
		expect(output).toContain("net"); // parent column

		expect(output).toContain("## summary");
	});

	it("shows BLOCKED-BY when task has unmet dependency", () => {
		const tickets: ParsedTicket[] = [
			t({ id: "v1", kind: "epic", status: "todo", title: "Epic" }),
			t({
				id: "net",
				kind: "story",
				status: "todo",
				parent: "v1",
				title: "Story",
			}),
			t({
				id: "proxy",
				kind: "task",
				status: "todo",
				parent: "net",
				depends_on: ["v1"],
				title: "Task",
			}),
		];
		const input: BoardInput = { trunkTickets: tickets, branchStatuses: [] };
		const output = renderBoard(input);

		// proxy should show BLOCKED-BY v1 (because v1 is not done)
		const lines = output.split("\n");
		const proxyLine = lines.find((l) => l.includes("proxy"));
		expect(proxyLine).toBeDefined();
		expect(proxyLine).toContain("v1");
	});

	it("shows empty BLOCKED-BY when all deps are done", () => {
		const tickets: ParsedTicket[] = [
			t({ id: "v1", kind: "epic", status: "done", title: "Epic" }),
			t({
				id: "net",
				kind: "story",
				status: "done",
				parent: "v1",
				title: "Story",
			}),
			t({
				id: "proxy",
				kind: "task",
				status: "todo",
				parent: "net",
				depends_on: ["v1"],
				title: "Task",
			}),
		];
		const input: BoardInput = { trunkTickets: tickets, branchStatuses: [] };
		const output = renderBoard(input);

		const lines = output.split("\n");
		const proxyLine = lines.find((l) => l.includes("proxy"));
		expect(proxyLine).toBeDefined();
		// BLOCKED-BY column should show " -" (empty placeholder)
		expect(proxyLine).toContain(" -");
		expect(proxyLine).not.toContain("v1");
	});

	it("resolves dep slugs across all kinds", () => {
		// A task depends on a story slug; the story is in stories, not tasks.
		const tickets: ParsedTicket[] = [
			t({
				id: "net",
				kind: "story",
				status: "todo",
				parent: null,
				title: "Story",
			}),
			t({
				id: "proxy",
				kind: "task",
				status: "todo",
				parent: "net",
				depends_on: ["net"],
				title: "Task",
			}),
		];
		const input: BoardInput = { trunkTickets: tickets, branchStatuses: [] };
		const output = renderBoard(input);

		expect(output).toContain("## stories");
		expect(output).toContain("## tasks");

		const lines = output.split("\n");
		const proxyLine = lines.find((l) => l.includes("proxy"));
		expect(proxyLine).toContain("net"); // BLOCKED-BY shows net
	});

	it("renders in-flight section with branch statuses", () => {
		const input: BoardInput = {
			trunkTickets: [],
			branchStatuses: [
				{ branch: "plan/proxy", status: "review", slug: "proxy" },
				{ branch: "plan/lint", status: "in_progress", slug: "port-lint" },
			],
		};
		const output = renderBoard(input);

		expect(output).toContain("## in flight (worktree branches)");
		expect(output).toContain("plan/proxy");
		expect(output).toContain("review");
		expect(output).toContain("port-lint");
		expect(output).toContain("in_progress");
	});

	it("has correct column header for all sections", () => {
		const tickets: ParsedTicket[] = [
			t({ id: "v1", kind: "epic", title: "E" }),
			t({ id: "s1", kind: "story", parent: "v1", title: "S" }),
			t({ id: "t1", kind: "task", parent: "s1", title: "T" }),
		];
		const input: BoardInput = { trunkTickets: tickets, branchStatuses: [] };
		const output = renderBoard(input);

		// Epics header: ID STATUS PARENT BLOCKED-BY TITLE
		expect(output).toContain("ID");
		expect(output).toContain("STATUS");
		expect(output).toContain("PARENT");
		expect(output).toContain("BLOCKED-BY");
		expect(output).toContain("TITLE");
	});

	it("handles null parent as '-'", () => {
		const tickets: ParsedTicket[] = [
			t({ id: "v1", kind: "epic", parent: null, title: "E" }),
		];
		const input: BoardInput = { trunkTickets: tickets, branchStatuses: [] };
		const output = renderBoard(input);

		const lines = output.split("\n");
		const v1Line = lines.find((l) => l.includes("v1") && l.includes("E"));
		expect(v1Line).toContain("-");
	});

	it("counts blocked tasks in summary", () => {
		const tickets: ParsedTicket[] = [
			t({ id: "v1", kind: "epic", status: "todo", title: "E" }),
			t({
				id: "t1",
				kind: "task",
				status: "todo",
				depends_on: ["v1"],
				title: "T",
			}),
		];
		const input: BoardInput = { trunkTickets: tickets, branchStatuses: [] };
		const output = renderBoard(input);

		expect(output).toContain("## summary");
		// t1 should be counted as blocked (v1 is not done)
		expect(output).toContain("blocked");
	});
});
