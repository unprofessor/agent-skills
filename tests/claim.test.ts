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
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claimTask } from "../src/claim.js";

const CLI = join(__dirname, "..", "skills", "planr", "dist", "cli", "claim.cjs");

function git(args: string[], opts: { cwd?: string } = {}): string {
	return execFileSync("git", args, {
		encoding: "utf-8",
		...opts,
	}) as string;
}

// ---- throwaway repo scaffolding (mirrors run-tests.sh claim scenario) ----

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
	const tmp = mkdtempSync(join(tmpdir(), "planr-claim-"));
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
		ticket("wire-cli", "task", "net-firewall", "todo", ["http-proxy"]),
	);
	git(["add", "."], { cwd: tmp });
	git(["commit", "-m", "backlog"], { cwd: tmp });
}

function cleanupRepo(tmp: string): void {
	const wt = join(tmp, "..", "wt-wire-cli");
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

// ---- library: claimTask ----

describe("claimTask (library)", () => {
	it("refuses when a cross-story depends_on is not done", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			expect(() =>
				claimTask({
					slug: "wire-cli",
					trunk: "main",
					planDir: ".plan",
					cwd: tmp,
				}),
			).toThrow(
				"refuse claim: 'wire-cli' has unfinished depends_on: http-proxy(todo)",
			);
			// no worktree / branch left behind on refusal
			expect(existsSync(join(tmp, "..", "wt-wire-cli"))).toBe(false);
			const branches = git(["branch", "--list", "plan/wire-cli"], {
				cwd: tmp,
			}).trim();
			expect(branches).toBe("");
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("succeeds once the dep is done, flipping status and bumping updated", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		// flip http-proxy to done on trunk
		const proxyPath = join(tmp, ".plan", "tasks", "01-http-proxy.md");
		const blob = readFileSync(proxyPath, "utf-8").replace(
			/^status: todo/m,
			"status: done",
		);
		writeFileSync(proxyPath, blob);
		git(["add", "."], { cwd: tmp });
		git(["commit", "-m", "http-proxy done"], { cwd: tmp });

		try {
			const wtPath = claimTask({
				slug: "wire-cli",
				trunk: "main",
				planDir: ".plan",
				worktree: "../wt-wire-cli",
				cwd: tmp,
			});
			expect(wtPath).toBe("../wt-wire-cli");

			// branch exists, worktree exists
			const branches = git(["branch", "--list", "plan/wire-cli"], {
				cwd: tmp,
			}).trim();
			expect(branches).toContain("plan/wire-cli");
			expect(existsSync(join(tmp, "..", "wt-wire-cli"))).toBe(true);

			// task file flipped in the worktree; updated bumped; body untouched
			const flipped = readFileSync(
				join(tmp, "..", "wt-wire-cli", ".plan", "tasks", "02-wire-cli.md"),
				"utf-8",
			);
			expect(flipped).toMatch(/^status: in_progress/m);
			expect(flipped).toMatch(/^updated: \d{4}-\d{2}-\d{2}$/m);
			expect(flipped).toContain("## Goal");
			// trunk task still todo
			const trunkBlob = readFileSync(proxyPath, "utf-8");
			expect(trunkBlob).toMatch(/^status: done/m);

			// flip committed on the branch
			const log = git(["log", "--oneline", "-1", "plan/wire-cli"], {
				cwd: tmp,
			}).trim();
			expect(log).toContain("plan: claim wire-cli (in_progress)");
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("supports block-style depends_on (gating still enforced)", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		// rewrite wire-cli to block-style depends_on
		const wcPath = join(tmp, ".plan", "tasks", "02-wire-cli.md");
		const blob = readFileSync(wcPath, "utf-8").replace(
			/^depends_on: \[http-proxy\]/m,
			"depends_on:\n  - http-proxy",
		);
		writeFileSync(wcPath, blob);
		git(["add", "."], { cwd: tmp });
		git(["commit", "-m", "block-style deps"], { cwd: tmp });

		try {
			expect(() =>
				claimTask({
					slug: "wire-cli",
					trunk: "main",
					planDir: ".plan",
					cwd: tmp,
				}),
			).toThrow(
				"refuse claim: 'wire-cli' has unfinished depends_on: http-proxy(todo)",
			);
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("errors when the task slug has no file on trunk", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			expect(() =>
				claimTask({ slug: "ghost", trunk: "main", planDir: ".plan", cwd: tmp }),
			).toThrow("no task file for slug 'ghost' on main");
		} finally {
			cleanupRepo(tmp);
		}
	});
});

// ---- CLI: dist/cli/claim.cjs (shim chain) ----

describe("claim CLI", () => {
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

	it("refuses with blocker names on stderr, exit 1", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		try {
			let err: unknown;
			try {
				execFileSync("node", [CLI, "wire-cli", "../wt-wire-cli"], {
					encoding: "utf-8",
					cwd: tmp,
				});
			} catch (e) {
				err = e;
			}
			const e = err as { status?: number; stderr?: string };
			expect(e.status).toBe(1);
			expect(e.stderr).toContain("http-proxy(todo)");
		} finally {
			cleanupRepo(tmp);
		}
	});

	it("succeeds once dep is done, printing only the worktree path", () => {
		const tmp = makeRepo();
		scaffoldBacklog(tmp);
		const proxyPath = join(tmp, ".plan", "tasks", "01-http-proxy.md");
		const blob = readFileSync(proxyPath, "utf-8").replace(
			/^status: todo/m,
			"status: done",
		);
		writeFileSync(proxyPath, blob);
		git(["add", "."], { cwd: tmp });
		git(["commit", "-m", "http-proxy done"], { cwd: tmp });

		try {
			const out = execFileSync("node", [CLI, "wire-cli", "../wt-wire-cli"], {
				encoding: "utf-8",
				cwd: tmp,
			});
			expect(out.trim()).toBe("../wt-wire-cli");
		} finally {
			cleanupRepo(tmp);
		}
	});
});
