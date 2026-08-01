#!/usr/bin/env node
// CLI stub for lint.sh — will be replaced by real logic in port-lint task.
import { parseTicket } from "../ticket.js";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";

function main(): void {
	console.log(`[lint] trunk=${trunk} planDir=${planDir} args=[${args.join(", ")}]`);
}

main();
