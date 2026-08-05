import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
	validateSlug,
	kindToSubdir,
	isValidKind,
	parentExists,
	allocatePrefix,
	createTicket,
} from "../src/new-ticket.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---- slug validation ----

describe("validateSlug", () => {
	it("accepts simple kebab-case", () => {
		expect(validateSlug("http-proxy")).toBe(true);
	});

	it("accepts single segment", () => {
		expect(validateSlug("lint")).toBe(true);
	});

	it("accepts digits", () => {
		expect(validateSlug("v1-ship")).toBe(true);
	});

	it("rejects leading hyphen", () => {
		expect(validateSlug("-bad")).toBe(false);
	});

	it("rejects trailing hyphen", () => {
		expect(validateSlug("bad-")).toBe(false);
	});

	it("rejects double hyphen", () => {
		expect(validateSlug("bad--slug")).toBe(false);
	});

	it("rejects uppercase", () => {
		expect(validateSlug("Bad-Slug")).toBe(false);
	});

	it("rejects empty", () => {
		expect(validateSlug("")).toBe(false);
	});

	it("rejects special chars", () => {
		expect(validateSlug("slug_with_underscore")).toBe(false);
	});
});

// ---- kind helpers ----

describe("kindToSubdir", () => {
	it("maps epic → epics", () => {
		expect(kindToSubdir("epic")).toBe("epics");
	});
	it("maps story → stories", () => {
		expect(kindToSubdir("story")).toBe("stories");
	});
	it("maps task → tasks", () => {
		expect(kindToSubdir("task")).toBe("tasks");
	});
	it("throws on unknown kind", () => {
		expect(() => kindToSubdir("foo")).toThrow("unknown kind");
	});
});

describe("isValidKind", () => {
	it("accepts epic/story/task", () => {
		expect(isValidKind("epic")).toBe(true);
		expect(isValidKind("story")).toBe(true);
		expect(isValidKind("task")).toBe(true);
	});
	it("rejects invalid", () => {
		expect(isValidKind("foo")).toBe(false);
	});
});

// ---- parent exists ----

describe("parentExists", () => {
	const tmp = join(tmpdir(), `planr-test-${Date.now()}`);

	beforeAll(() => {
		mkdirSync(join(tmp, ".plan", "stories"), { recursive: true });
		mkdirSync(join(tmp, ".plan", "epics"), { recursive: true });
		mkdirSync(join(tmp, ".plan", "tasks"), { recursive: true });
		writeFileSync(join(tmp, ".plan", "epics", "01-my-epic.md"), "");
		writeFileSync(join(tmp, ".plan", "stories", "03-some-story.md"), "");
	});

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("finds parent in epics", () => {
		expect(parentExists("my-epic", join(tmp, ".plan"))).toBe(true);
	});

	it("finds parent in stories", () => {
		expect(parentExists("some-story", join(tmp, ".plan"))).toBe(true);
	});

	it("returns false for missing parent", () => {
		expect(parentExists("no-such", join(tmp, ".plan"))).toBe(false);
	});

	it("returns false for empty dir", () => {
		const empty = join(tmpdir(), `planr-empty-${Date.now()}`);
		mkdirSync(empty, { recursive: true });
		try {
			expect(parentExists("anything", empty)).toBe(false);
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});
});

// ---- prefix allocation ----

describe("allocatePrefix", () => {
	const tmp = join(tmpdir(), `planr-prefix-${Date.now()}`);

	beforeAll(() => {
		mkdirSync(tmp, { recursive: true });
		writeFileSync(join(tmp, "01-first.md"), "");
		writeFileSync(join(tmp, "05-fifth.md"), "");
		writeFileSync(join(tmp, "12-twelfth.md"), "");
		writeFileSync(join(tmp, "not-ticket.md"), "");
	});

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("returns 01 for empty dir", () => {
		const empty = join(tmpdir(), `planr-empty-prefix-${Date.now()}`);
		mkdirSync(empty, { recursive: true });
		try {
			expect(allocatePrefix(empty)).toBe("01");
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});

	it("returns next after highest", () => {
		expect(allocatePrefix(tmp)).toBe("13");
	});

	it("returns zero-padded two-digit", () => {
		// Should always be two digits
		const result = allocatePrefix(tmp);
		expect(result).toMatch(/^\d{2}$/);
	});
});

// ---- createTicket integration ----

describe("createTicket", () => {
	const tmp = join(tmpdir(), `planr-create-${Date.now()}`);
	const planDir = join(tmp, ".plan");
	const templatesDir = join(tmp, "templates");

	beforeAll(() => {
		mkdirSync(join(planDir, "epics"), { recursive: true });
		mkdirSync(join(planDir, "stories"), { recursive: true });
		mkdirSync(join(planDir, "tasks"), { recursive: true });
		mkdirSync(templatesDir, { recursive: true });

		// Create minimal templates
		writeFileSync(
			join(templatesDir, "epic.md"),
			[
				"---",
				"id: __SLUG__",
				"aliases: [__SLUG__]",
				"kind: epic",
				"title: __TITLE__",
				"status: todo",
				"assignee: null",
				"created: __DATE__",
				"updated: __DATE__",
				"tags: []",
				"---",
				"",
				"## Goal",
				"__TITLE__",
				"",
			].join("\n"),
		);

		writeFileSync(
			join(templatesDir, "story.md"),
			[
				"---",
				"id: __SLUG__",
				"aliases: [__SLUG__]",
				"kind: story",
				"parent: __PARENT__",
				"title: __TITLE__",
				"status: todo",
				"assignee: null",
				"created: __DATE__",
				"updated: __DATE__",
				"tags: []",
				"depends_on: []",
				"---",
				"",
				"## Goal",
				"__TITLE__",
				"",
			].join("\n"),
		);

		writeFileSync(
			join(templatesDir, "task.md"),
			[
				"---",
				"id: __SLUG__",
				"aliases: [__SLUG__]",
				"kind: task",
				"parent: __PARENT__",
				"title: __TITLE__",
				"status: todo",
				"assignee: null",
				"created: __DATE__",
				"updated: __DATE__",
				"tags: []",
				"depends_on: []",
				"---",
				"",
				"## Goal",
				"__TITLE__",
				"",
			].join("\n"),
		);

		// Create a parent epic
		writeFileSync(join(planDir, "epics", "01-test-epic.md"), "");
	});

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("creates an epic", () => {
		const path = createTicket(
			"epic",
			"my-epic",
			"My Epic",
			null,
			planDir,
			templatesDir,
		);
		expect(path).toContain("epics/");
		expect(path).toMatch(/\d{2}-my-epic\.md$/);
		expect(existsSync(path)).toBe(true);
	});

	it("creates a story with parent", () => {
		const path = createTicket(
			"story",
			"my-story",
			"My Story",
			"test-epic",
			planDir,
			templatesDir,
		);
		expect(path).toContain("stories/");
		expect(existsSync(path)).toBe(true);
	});

	it("creates a task with parent", () => {
		// Need a story parent first
		writeFileSync(join(planDir, "stories", "01-my-story.md"), "");
		const path = createTicket(
			"task",
			"my-task",
			"My Task",
			"my-story",
			planDir,
			templatesDir,
		);
		expect(path).toContain("tasks/");
		expect(existsSync(path)).toBe(true);
	});

	it("rejects bad slug (uppercase)", () => {
		expect(() =>
			createTicket("epic", "Bad-Slug", "Bad", null, planDir, templatesDir),
		).toThrow("bad slug");
	});

	it("rejects bad slug (trailing hyphen)", () => {
		expect(() =>
			createTicket("epic", "bad-", "Bad", null, planDir, templatesDir),
		).toThrow("bad slug");
	});

	it("rejects bad slug (double hyphen)", () => {
		expect(() =>
			createTicket("epic", "bad--slug", "Bad", null, planDir, templatesDir),
		).toThrow("bad slug");
	});

	it("rejects story without parent", () => {
		expect(() =>
			createTicket("story", "orphan", "Orphan", null, planDir, templatesDir),
		).toThrow("parent slug required");
	});

	it("rejects task without parent", () => {
		expect(() =>
			createTicket("task", "orphan", "Orphan", null, planDir, templatesDir),
		).toThrow("parent slug required");
	});

	it("rejects dangling parent", () => {
		expect(() =>
			createTicket(
				"story",
				"orphan-story",
				"Orphan",
				"no-such-parent",
				planDir,
				templatesDir,
			),
		).toThrow("parent 'no-such-parent' not found");
	});

	it("rejects unknown kind", () => {
		expect(() =>
			createTicket(
				"foo" as "epic",
				"blah",
				"Blah",
				null,
				planDir,
				templatesDir,
			),
		).toThrow("unknown kind");
	});

	it("fills aliases inline", () => {
		const path = createTicket(
			"epic",
			"test-aliases",
			"Test Aliases",
			null,
			planDir,
			templatesDir,
		);
		const content = require("node:fs").readFileSync(path, "utf-8");
		expect(content).toContain("aliases: [test-aliases]");
	});

	it("fills date in YYYY-MM-DD format", () => {
		const path = createTicket(
			"epic",
			"test-date",
			"Test Date",
			null,
			planDir,
			templatesDir,
		);
		const content = require("node:fs").readFileSync(path, "utf-8");
		expect(content).toMatch(/created: \d{4}-\d{2}-\d{2}/);
		expect(content).toMatch(/updated: \d{4}-\d{2}-\d{2}/);
	});

	it("fills title in Goal section", () => {
		const path = createTicket(
			"epic",
			"test-title",
			"Test Title Here",
			null,
			planDir,
			templatesDir,
		);
		const content = require("node:fs").readFileSync(path, "utf-8");
		expect(content).toContain("## Goal");
		expect(content).toContain("Test Title Here");
	});
});
