import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
	execFileSync,
	type ExecFileSyncOptions,
} from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(__dirname, "..", "dist", "cli", "review.cjs");

function git(args: string[], opts: ExecFileSyncOptions = {}): string {
	return execFileSync("git", args, {
		encoding: "utf-8",
		...opts,
	});
}

describe("review CLI", () => {
	let tmp: string;

	beforeAll(() => {
		tmp = mkdtempSync(join(tmpdir(), "planr-review-test-"));
		git(["init", "-b", "main", tmp]);
		// configure git user for commits
		git(["config", "user.email", "test@test"], { cwd: tmp });
		git(["config", "user.name", "Test"], { cwd: tmp });
	});

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function writeCommit(filename: string, content: string, msg: string) {
		writeFileSync(join(tmp, filename), content);
		git(["add", filename], { cwd: tmp });
		git(["commit", "-m", msg], { cwd: tmp });
	}

	it("prints task slug required when no args given", () => {
		// Run CLI with no args — should fail
		try {
			execFileSync("node", [CLI], { encoding: "utf-8", cwd: tmp });
			expect.unreachable("should have thrown");
		} catch (e: unknown) {
			const err = e as { stderr?: string; status?: number };
			expect(err.status).toBe(1);
		}
	});

	it("errors on non-existent branch", () => {
		try {
			execFileSync("node", [CLI, "nonexistent"], {
				encoding: "utf-8",
				cwd: tmp,
			});
			expect.unreachable("should have thrown");
		} catch (e: unknown) {
			const err = e as { stderr?: string; status?: number };
			expect(err.status).toBe(1);
		}
	});

	it("prints review brief for a task on plan/<slug> branch", () => {
		// Create .plan/tasks directory with a task file
		const planTasksDir = join(tmp, ".plan", "tasks");
		execFileSync("mkdir", ["-p", planTasksDir]);

		const taskContent = `---
id: smoke-test
aliases: [smoke-test]
kind: task
parent: some-story
title: Smoke test for review CLI
status: review
assignee: null
created: 2026-08-01
updated: 2026-08-01
tags: []
depends_on: []
---

## Goal

Test the review CLI.

## Acceptance

- [x] First item
- [x] Second item with **bold**

## Validation

I checked the thing.



It had blank lines above — should be stripped.

Yep.

## Review

verdict: approved
`;

		const taskPath = join(".plan", "tasks", "03-smoke-test.md");
		writeCommit(taskPath, taskContent, "add smoke test task");

		// Create a branch plan/smoke-test off main
		const mainSha = git(["rev-parse", "HEAD"], { cwd: tmp }).trim();
		git(["checkout", "-b", "plan/smoke-test", mainSha], { cwd: tmp });

		// Run the review CLI on the branch
		const output = execFileSync("node", [CLI, "smoke-test"], {
			encoding: "utf-8",
			cwd: tmp,
		});

		// Check key sections
		expect(output).toContain("branch:    plan/smoke-test");
		expect(output).toContain("task:      .plan/tasks/03-smoke-test.md");
		expect(output).toContain("--- acceptance ---");
		expect(output).toContain("First item");
		expect(output).toContain("Second item with **bold**");
		expect(output).toContain("--- validation (worker self-check) ---");
		expect(output).toContain("I checked the thing.");
		expect(output).toContain("Yep.");
		// Blank lines should be stripped from validation
		const validationSection = output.slice(
			output.indexOf("--- validation"),
			output.indexOf("--- diff"),
		);
		expect(validationSection).not.toContain("\n\n\n");
		expect(output).toContain("--- diff vs main ---");
		expect(output).toContain(
			"--- reviewer guidance ---",
		);
		expect(output).toContain("verdict: approved");
	});
});
