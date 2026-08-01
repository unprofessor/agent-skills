#!/usr/bin/env node
// CLI entry for review.sh — prints the review brief for a task.
import { generateReviewBrief } from "../review.js";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";

function main(): void {
	const slug = args[0];
	if (!slug) {
		console.error("task slug required");
		process.exit(1);
	}

	try {
		const brief = generateReviewBrief({ slug, trunk, planDir });
		process.stdout.write(brief);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message);
		process.exit(1);
	}
}

main();
