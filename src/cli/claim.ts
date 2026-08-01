#!/usr/bin/env node
// CLI stub for claim.sh — will be replaced by real logic in port-claim task.
import { worktreeAdd, branchList, revParseVerify } from "../git.js";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";

function main(): void {
	console.log(
		`[claim] trunk=${trunk} planDir=${planDir} args=[${args.join(", ")}]`,
	);
}

main();
