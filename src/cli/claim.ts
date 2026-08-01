#!/usr/bin/env node
// CLI entry for claim.sh — claim a task: worktree branch + in_progress flip.
import { claimTask } from "../claim.js";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const trunkEnv = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";

function main(): void {
	const slug = args[0];
	if (!slug) {
		console.error("task slug required");
		process.exit(1);
	}
	const wt = args[1] ?? `../wt-${slug}`;
	const trunk = args[2] ?? trunkEnv;

	// Informational backlog lint of trunk on stderr (like bash claim.sh's
	// `"$here/lint.sh" "$trunk" >&2 || true`); the authoritative gate is the
	// per-task dependency check inside claimTask. The lint CLI prints via
	// console.log (stdout), so pipe it and re-emit to stderr — stdout must stay
	// exactly the worktree path.
	try {
		const lintCli = join(dirname(process.argv[1] ?? "."), "lint.cjs");
		const lintOut = execFileSync(process.execPath, [lintCli, trunk], {
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf-8",
		});
		if (lintOut) process.stderr.write(lintOut);
	} catch (err: unknown) {
		// informational only — surface lint output, never fail the claim
		const e = err as { stdout?: string | Buffer };
		const out =
			typeof e.stdout === "string"
				? e.stdout
				: Buffer.isBuffer(e.stdout)
					? e.stdout.toString("utf-8")
					: "";
		if (out) process.stderr.write(out);
	}

	try {
		const wtPath = claimTask({ slug, trunk, planDir, worktree: wt });
		process.stdout.write(`${wtPath}\n`);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message);
		process.exit(1);
	}
}

main();
