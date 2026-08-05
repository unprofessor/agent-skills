import { describe, it, expect } from "vitest";
import { checkBacklog } from "../src/lint.js";
import type { LintInput } from "../src/lint.js";
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

function input(file: string, ticket: ParsedTicket): LintInput {
	return { file, ticket };
}

describe("checkBacklog", () => {
	it("clean backlog produces no errors", () => {
		const epic = t({ id: "v1", kind: "epic" });
		const story = t({ id: "net", kind: "story", parent: "v1" });
		const task = t({ id: "proxy", kind: "task", parent: "net" });

		const report = checkBacklog([
			input(".plan/epics/01-v1.md", epic),
			input(".plan/stories/01-net.md", story),
			input(".plan/tasks/01-proxy.md", task),
		]);

		expect(report.errorCount).toBe(0);
		expect(report.warningCount).toBe(0);
	});

	it("detects missing id", () => {
		const ticket = t({ id: "", kind: "epic" });
		const report = checkBacklog([input(".plan/epics/01-v1.md", ticket)]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(report.issues.some((i) => i.message.includes("missing id"))).toBe(
			true,
		);
	});

	it("detects mismatched id vs filename slug", () => {
		const ticket = t({ id: "wrong", kind: "epic" });
		const report = checkBacklog([input(".plan/epics/01-v1.md", ticket)]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) =>
				i.message.includes("does not match filename slug"),
			),
		).toBe(true);
	});

	it("detects kind/dir mismatch", () => {
		const ticket = t({ id: "v1", kind: "story" });
		const report = checkBacklog([input(".plan/epics/01-v1.md", ticket)]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) =>
				i.message.includes("but the file lives in the epics directory"),
			),
		).toBe(true);
	});

	it("detects invalid status", () => {
		const ticket = t({ id: "v1", kind: "epic", status: "finished" as any });
		const report = checkBacklog([input(".plan/epics/01-v1.md", ticket)]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) => i.message.includes("invalid status")),
		).toBe(true);
	});

	it("detects duplicate slug", () => {
		const a = t({ id: "dup", kind: "epic" });
		const b = t({ id: "dup", kind: "story", parent: "dup" });
		const report = checkBacklog([
			input(".plan/epics/01-dup.md", a),
			input(".plan/stories/01-dup.md", b),
		]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) => i.message.includes("duplicate slug")),
		).toBe(true);
	});

	it("detects epic with parent", () => {
		const ticket = t({ id: "v1", kind: "epic", parent: "something" });
		const report = checkBacklog([input(".plan/epics/01-v1.md", ticket)]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) =>
				i.message.includes("epics must not have a parent"),
			),
		).toBe(true);
	});

	it("detects story/task without parent", () => {
		const ticket = t({ id: "net", kind: "story" });
		const report = checkBacklog([input(".plan/stories/01-net.md", ticket)]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) => i.message.includes("must name a parent slug")),
		).toBe(true);
	});

	it("detects dangling parent", () => {
		const ticket = t({ id: "proxy", kind: "task", parent: "ghost" });
		const report = checkBacklog([input(".plan/tasks/01-proxy.md", ticket)]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) =>
				i.message.includes("parent 'ghost' does not exist"),
			),
		).toBe(true);
	});

	it("warns on wrong-kind parent", () => {
		const task1 = t({ id: "proxy", kind: "task", parent: "v1" });
		const epic = t({ id: "v1", kind: "epic" });
		const report = checkBacklog([
			input(".plan/tasks/01-proxy.md", task1),
			input(".plan/epics/01-v1.md", epic),
		]);
		expect(report.warningCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) => i.message.includes("usually a story")),
		).toBe(true);
		expect(report.errorCount).toBe(0);
	});

	it("detects dangling depends_on", () => {
		const epic = t({ id: "v1", kind: "epic" });
		const task1 = t({
			id: "a",
			kind: "task",
			parent: "v1",
			depends_on: ["ghost-task"],
		});
		const report = checkBacklog([
			input(".plan/epics/01-v1.md", epic),
			input(".plan/tasks/01-a.md", task1),
		]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) =>
				i.message.includes("depends_on 'ghost-task' does not exist"),
			),
		).toBe(true);
	});

	it("detects self-dependency (not as cycle)", () => {
		const epic = t({ id: "v1", kind: "epic" });
		const task1 = t({ id: "a", kind: "task", parent: "v1", depends_on: ["a"] });
		const report = checkBacklog([
			input(".plan/epics/01-v1.md", epic),
			input(".plan/tasks/01-a.md", task1),
		]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(report.issues.some((i) => i.message === "depends_on itself")).toBe(
			true,
		);
		// Must NOT report a cycle for self-dep
		expect(
			report.issues.some((i) => i.message.includes("depends_on cycle")),
		).toBe(false);
	});

	it("detects dependency cycle", () => {
		const epic = t({ id: "v1", kind: "epic" });
		const a = t({ id: "a", kind: "task", parent: "v1", depends_on: ["b"] });
		const b = t({ id: "b", kind: "task", parent: "v1", depends_on: ["c"] });
		const c = t({ id: "c", kind: "task", parent: "v1", depends_on: ["a"] });
		const report = checkBacklog([
			input(".plan/epics/01-v1.md", epic),
			input(".plan/tasks/01-a.md", a),
			input(".plan/tasks/02-b.md", b),
			input(".plan/tasks/03-c.md", c),
		]);
		expect(report.errorCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) => i.message.includes("depends_on cycle")),
		).toBe(true);
	});

	it("warns on unresolved wiki-link", () => {
		const epic = t({ id: "v1", kind: "epic", links: ["no-such-note"] });
		const report = checkBacklog([input(".plan/epics/01-v1.md", epic)]);
		expect(report.warningCount).toBeGreaterThanOrEqual(1);
		expect(
			report.issues.some((i) =>
				i.message.includes("[[no-such-note]] matches no ticket slug"),
			),
		).toBe(true);
		expect(report.errorCount).toBe(0);
	});

	it("does not error on block-style depends_on (parsed correctly)", () => {
		// Block-style YAML depends_on is parsed by eemeli/yaml into a proper
		// array. The old bash lint errored on this; the TS lint must not.
		const epic = t({ id: "v1", kind: "epic" });
		const task1 = t({ id: "a", kind: "task", parent: "v1", depends_on: [] });
		const task2 = t({ id: "b", kind: "task", parent: "v1", depends_on: ["a"] });
		const report = checkBacklog([
			input(".plan/epics/01-v1.md", epic),
			input(".plan/tasks/01-a.md", task1),
			input(".plan/tasks/02-b.md", task2),
		]);
		// Block-style dep "a" was parsed correctly — no error about missing dep
		expect(
			report.issues.some((i) =>
				i.message.includes("depends_on 'a' does not exist"),
			),
		).toBe(false);
		expect(report.errorCount).toBe(0);
	});

	it("reports status 'blocked' as valid", () => {
		const ticket = t({ id: "v1", kind: "epic", status: "blocked" });
		const report = checkBacklog([input(".plan/epics/01-v1.md", ticket)]);
		expect(
			report.issues.some((i) => i.message.includes("invalid status")),
		).toBe(false);
	});

	it("parent null is valid for epic", () => {
		const ticket = t({ id: "v1", kind: "epic", parent: null });
		const report = checkBacklog([input(".plan/epics/01-v1.md", ticket)]);
		expect(report.issues.some((i) => i.message.includes("parent"))).toBe(false);
	});

	it("empty backlog produces no errors", () => {
		const report = checkBacklog([]);
		expect(report.errorCount).toBe(0);
		expect(report.warningCount).toBe(0);
	});
});
