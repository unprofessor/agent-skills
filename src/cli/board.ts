#!/usr/bin/env node
// CLI stub for board.sh — will be replaced by real logic in port-board task.
import { parseTicket } from "../ticket.js";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";

function main(): void {
	// Stub: just prove the chain works.
	console.log(
		`[board] trunk=${trunk} planDir=${planDir} args=[${args.join(", ")}]`,
	);
}

main();
