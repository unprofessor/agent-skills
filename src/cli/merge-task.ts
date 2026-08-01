#!/usr/bin/env node
// CLI entry for merge-task.sh — merge a reviewed-and-approved task branch
// into trunk: guards status=review + approved verdict, merges --no-ff,
// flips to done, cleans up worktree + branch, handles conflicts with guidance.
import { mergeTask } from "../merge-task.js";

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

	try {
		const msg = mergeTask({ slug, trunk, planDir, worktree: wt });
		process.stdout.write(`${msg}\n`);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message);
		process.exit(1);
	}
}

main();
