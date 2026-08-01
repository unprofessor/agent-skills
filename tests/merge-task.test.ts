import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { mergeTask } from "../src/merge-task.js";
import { claimTask } from "../src/claim.js";

const CLI = join(__dirname, "..", "skills", "planr", "dist", "cli", "merge-task.cjs");

function git(args: string[], opts: { cwd?: string } = {}): string {
	return execFileSync("git", args, {
		encoding: "utf-8",
		...opts,
	}) as string;
}

// ---- throwaway repo scaffolding (mirrors run-tests.sh merge scenario) ----

function ticket(
	slug: string,
	kind: string,
	parent: string,
	status: string,
	dependsOn: string[],
): string {
	const deps = dependsOn.length > 0 ? `[${dependsOn.join(", ")}]` : "[]";
	return [
		"---",
		`id: ${slug}`,
		`aliases: [${slug}]`,
		`kind: ${kind}`,
		`parent: ${parent}`,
		`title: ${slug} ticket`,
		`status: ${status}`,
		"assignee: null",
		"created: 2026-08-01",
		"updated: 2026-08-01",
		"tags: []",
		`depends_on: ${deps}`,
		"---",
		"",
		"## Goal",
		`Goal for ${slug}.`,
		"",
	].join("\n");
}

function makeRepo(): string {
	const tmp = mkdtempSync(join(tmpdir(), "planr-merge-"));
	git(["init", "-b", "main", tmp]);
	git(["config", "user.email", "test@test"], { cwd: tmp });
	git(["config", "user.name", "Test"], { cwd: tmp });
	mkdirSync(join(tmp, ".plan", "epics"), { recursive: true });
	mkdirSync(join(tmp, ".plan", "stories"), { recursive: true });
	mkdirSync(join(tmp, ".plan", "tasks"), { recursive: true });
	return tmp;
}

function scaffoldBacklog(tmp: string): void {
	writeFileSync(
		join(tmp, ".plan", "stories", "01-net-firewall.md"),
		ticket("net-firewall", "story", "net", "todo", []),
	);
	writeFileSync(
		join(tmp, ".plan", "tasks", "01-http-proxy.md"),
		ticket("http-proxy", "task", "net-firewall", "todo", []),
	);
	writeFileSync(
		join(tmp, ".plan", "tasks", "02-wire-cli.md"),
		ticket("wire-cli", "task", "net-firewall", "todo", []),
	);
	git(["add", "."], { cwd: tmp });
	git(["commit", "-m", "backlog"], { cwd: tmp });
}

// Unique worktree path per test repo: the tmp dirs live under /tmp and the
// worktree must be OUTSIDE the repo, so `../wt-<tmp-basename>` is unique per
// test — the claim tests already use a shared '../wt-wire-cli', so colliding
// with it would break concurrent vitest workers.
function wtFor(tmp: string): string {
	return join(tmp, "..", `wt-${basename(tmp)}`);
}

/**
 * Bring wire-cli to a review-ready state (the state a worker hands back):
 * dep done on trunk, branch claimed (in_progress), then in the worktree the
 * task is flipped to status: review with a ## Review block verdict approved.
 * Returns the worktree path.
 */
function setupReviewTask(tmp: string): string {
	const proxyPath = join(tmp, ".plan", "tasks", "01-http-proxy.md");
	const blob = readFileSync(proxyPath, "utf-8").replace(
		/^status: todo/m,
		"status: done",
	);
	writeFileSync(proxyPath, blob);
	git(["add", "."], { cwd: tmp });
	git(["commit", "-m", "http-proxy done"], { cwd: tmp });

	const wtPath = claimTask({
		slug: "wire-cli",
		trunk: "main",
		planDir: ".plan",
		worktree: wtFor(tmp),
		cwd: tmp,
	});
	const wtAbs = wtFor(tmp);
	const taskPath = join(wtAbs, ".plan", "tasks", "02-wire-cli.md");
	const taskBlob = readFileSync(taskPath, "utf-8")
		.replace(/^status: in_progress/m, "status: review")
		.replace(/^updated: .*$/m, "updated: 2026-08-01");
	writeFileSync(
		taskPath,
		`${taskBlob}\n## Review\n\nverdict: approved\nreviewer: test\n`,
	);
	git(["add", "."], { cwd: wtAbs });
	git(["commit", "-m", "review: approved"], { cwd: wtAbs });
	return wtPath;
}

function cleanupRepo(tmp: string): void {
	const wt = wtFor(tmp);
	try {
		git(["worktree", "remove", "--force", wt], { cwd: tmp });
	} catch {
		// no worktree — fine
	}
	try {
		git(["branch", "-D", "plan/wire-cli"], { cwd: tmp });
	} catch {
		// no branch — fine
	}
	rmSync(wt, { recursive: true, force: true });
	rmSync(tmp, { recursive: true, force: true });
}

// ---- library: mergeTask ----

describe("mergeTask (library)", () => {
	it("refuses when the branch does not exist", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			expect(() =>
				mergeTask({ slug: "ghost", trunk: "main", planDir: ".plan", cwd: tmp }),
			).toThrow("no such branch: plan/ghost");
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("refuses when the slug has no task file on the branch", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			// branch exists (points at main) but holds no matching task file
			git(["branch", "plan/ghost"], { cwd: tmp });
			expect(() =>
				mergeTask({ slug: "ghost", trunk: "main", planDir: ".plan", cwd: tmp }),
			).toThrow("no task file for 'ghost' on plan/ghost");
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("refuses when status is not review", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);
			// flip back to in_progress on the branch (simulates unvalidated task)
			const wtAbs = wtFor(tmp);
			const taskPath = join(wtAbs, ".plan", "tasks", "02-wire-cli.md");
			const taskBlob = readFileSync(taskPath, "utf-8").replace(
				/^status: review/m,
				"status: in_progress",
			);
			writeFileSync(taskPath, taskBlob);
			git(["add", "."], { cwd: wtAbs });
			git(["commit", "-m", "back to in_progress"], { cwd: wtAbs });

			expect(() =>
				mergeTask({
					slug: "wire-cli",
					trunk: "main",
					planDir: ".plan",
					cwd: tmp,
				}),
			).toThrow(
				"refuse merge: task 'wire-cli' status is 'in_progress', must be 'review'.",
			);
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("refuses when the verdict is not approved (changes-requested)", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);
			const wtAbs = wtFor(tmp);
			const taskPath = join(wtAbs, ".plan", "tasks", "02-wire-cli.md");
			const taskBlob = readFileSync(taskPath, "utf-8").replace(
				/^verdict: approved/m,
				"verdict: changes-requested",
			);
			writeFileSync(taskPath, taskBlob);
			git(["add", "."], { cwd: wtAbs });
			git(["commit", "-m", "changes requested"], { cwd: wtAbs });

			expect(() =>
				mergeTask({
					slug: "wire-cli",
					trunk: "main",
					planDir: ".plan",
					cwd: tmp,
				}),
			).toThrow(
				"refuse merge: no approved review verdict on 'wire-cli' (found: 'changes-requested').",
			);
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("refuses when there is no ## Review block (found: 'none')", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);
			const wtAbs = wtFor(tmp);
			const taskPath = join(wtAbs, ".plan", "tasks", "02-wire-cli.md");
			const taskBlob = readFileSync(taskPath, "utf-8").replace(
				/\n## Review\n\nverdict: approved\nreviewer: test\n/,
				"\n",
			);
			writeFileSync(taskPath, taskBlob);
			git(["add", "."], { cwd: wtAbs });
			git(["commit", "-m", "drop review"], { cwd: wtAbs });

			expect(() =>
				mergeTask({
					slug: "wire-cli",
					trunk: "main",
					planDir: ".plan",
					cwd: tmp,
				}),
			).toThrow(
				"refuse merge: no approved review verdict on 'wire-cli' (found: 'none').",
			);
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("accepts a verdict with trailing whitespace (trimmed)", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);
			const wtAbs = wtFor(tmp);
			const taskPath = join(wtAbs, ".plan", "tasks", "02-wire-cli.md");
			const taskBlob = readFileSync(taskPath, "utf-8").replace(
				/^verdict: approved/m,
				"verdict: approved ",
			);
			writeFileSync(taskPath, taskBlob);
			git(["add", "."], { cwd: wtAbs });
			git(["commit", "-m", "trailing space verdict"], { cwd: wtAbs });

			const out = mergeTask({
				slug: "wire-cli",
				trunk: "main",
				planDir: ".plan",
				worktree: wtFor(tmp),
				cwd: tmp,
			});
			expect(out).toBe("merged plan/wire-cli into main; wire-cli done");
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("merges an approved task: flips to done, bumps updated, cleans up", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);

			const out = mergeTask({
				slug: "wire-cli",
				trunk: "main",
				planDir: ".plan",
				worktree: wtFor(tmp),
				cwd: tmp,
			});
			expect(out).toBe("merged plan/wire-cli into main; wire-cli done");

			// merge commit + flip commit on trunk
			const log = git(["log", "--oneline", "-3"], { cwd: tmp });
			expect(log).toContain("plan: mark wire-cli done");
			expect(log).toContain("plan: merge wire-cli");

			// task flipped to done on trunk; updated bumped; body (## Review) intact
			const merged = readFileSync(
				join(tmp, ".plan", "tasks", "02-wire-cli.md"),
				"utf-8",
			);
			expect(merged).toMatch(/^status: done/m);
			expect(merged).toMatch(/^updated: \d{4}-\d{2}-\d{2}$/m);
			expect(merged).toContain("## Review");
			expect(merged).toContain("verdict: approved");

			// branch deleted, worktree removed
			const branches = git(["branch", "--list", "plan/wire-cli"], {
				cwd: tmp,
			}).trim();
			expect(branches).toBe("");
			expect(existsSync(wtFor(tmp))).toBe(false);

			// trunk clean
			expect(git(["status", "--porcelain"], { cwd: tmp }).trim()).toBe("");
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("aborts on merge conflict, leaves worktree + branch intact, prints rebase guidance", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);
			// conflict: modify the SAME task file on trunk after the branch was cut
			const trunkTask = join(tmp, ".plan", "tasks", "02-wire-cli.md");
			writeFileSync(
				trunkTask,
				readFileSync(trunkTask, "utf-8") + "\nChanged on trunk.\n",
			);
			git(["add", "."], { cwd: tmp });
			git(["commit", "-m", "trunk change to wire-cli"], { cwd: tmp });
			const trunkHead = git(["rev-parse", "HEAD"], { cwd: tmp }).trim();

			let err: unknown;
			try {
				mergeTask({
					slug: "wire-cli",
					trunk: "main",
					planDir: ".plan",
					cwd: tmp,
				});
			} catch (e) {
				err = e;
			}
			const e = err as Error;
			expect(e).toBeDefined();
			expect(e.message).toContain("merge conflict in:");
			expect(e.message).toContain("02-wire-cli.md");
			expect(e.message).toContain(
				"The worker must rebase onto fresh trunk and resolve:",
			);
			expect(e.message).toContain("git rebase main");

			// worktree + branch preserved
			expect(existsSync(wtFor(tmp))).toBe(true);
			const branches = git(["branch", "--list", "plan/wire-cli"], {
				cwd: tmp,
			}).trim();
			expect(branches).toContain("plan/wire-cli");

			// merge aborted: trunk HEAD unchanged, working tree clean
			expect(git(["rev-parse", "HEAD"], { cwd: tmp }).trim()).toBe(trunkHead);
			expect(git(["status", "--porcelain"], { cwd: tmp }).trim()).toBe("");
		} finally {
			cleanupRepo(tmp);
		}
	});
});

// ---- CLI: dist/cli/merge-task.cjs (shim chain) ----

describe("merge-task CLI", () => {
	it("prints task slug required when no args given", () => {
		const tmp = makeRepo();
		try {
			expect(() =>
				execFileSync("node", [CLI], { encoding: "utf-8", cwd: tmp }),
			).toThrow();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("refuses with the exact message on stderr, exit 1", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);
			const wtAbs = wtFor(tmp);
			const taskPath = join(wtAbs, ".plan", "tasks", "02-wire-cli.md");
			const taskBlob = readFileSync(taskPath, "utf-8").replace(
				/^status: review/m,
				"status: done",
			);
			writeFileSync(taskPath, taskBlob);
			git(["add", "."], { cwd: wtAbs });
			git(["commit", "-m", "done early"], { cwd: wtAbs });

			let err: unknown;
			try {
				execFileSync("node", [CLI, "wire-cli", wtFor(tmp)], {
					encoding: "utf-8",
					cwd: tmp,
				});
			} catch (e) {
				err = e;
			}
			const e = err as { status?: number; stderr?: string };
			expect(e.status).toBe(1);
			expect(e.stderr).toContain(
				"refuse merge: task 'wire-cli' status is 'done', must be 'review'.",
			);
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("succeeds end-to-end, printing the merge confirmation", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			setupReviewTask(tmp);
			const out = execFileSync("node", [CLI, "wire-cli", wtFor(tmp)], {
				encoding: "utf-8",
				cwd: tmp,
			});
			expect(out.trim()).toBe("merged plan/wire-cli into main; wire-cli done");
			const merged = readFileSync(
				join(tmp, ".plan", "tasks", "02-wire-cli.md"),
				"utf-8",
			);
			expect(merged).toMatch(/^status: done/m);
		} finally {
			cleanupRepo(tmp);
		}
	});
});
