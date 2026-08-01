#!/usr/bin/env node
// CLI stub for merge-task.sh — will be replaced by real logic in port-merge-task task.
import {
	mergeNoFf, worktreeRemove, branchDelete, checkout,
} from "../git.js";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";

function main(): void {
	console.log(`[merge-task] trunk=${trunk} planDir=${planDir} args=[${args.join(", ")}]`);
}

main();
