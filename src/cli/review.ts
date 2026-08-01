#!/usr/bin/env node
// CLI stub for review.sh — will be replaced by real logic in port-review task.
import { parseTicket } from "../ticket.js";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";

function main(): void {
	console.log(`[review] trunk=${trunk} planDir=${planDir} args=[${args.join(", ")}]`);
}

main();
