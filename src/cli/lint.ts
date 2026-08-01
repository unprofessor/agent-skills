#!/usr/bin/env node
// CLI entry for lint.sh — drives the typed lint engine.
import { parseTicket } from "../ticket.js";
import { checkBacklog } from "../lint.js";
import type { LintInput } from "../lint.js";
import { lsTreeMd, showRef } from "../git.js";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";
const ref = args[0]; // optional ref

const kinds = ["epics", "stories", "tasks"] as const;

function readWorkingTree(): LintInput[] {
	const results: LintInput[] = [];
	for (const kind of kinds) {
		const dir = join(planDir, kind);
		if (!existsSync(dir)) continue;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		entries.sort();
		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;
			const fpath = join(planDir, kind, entry);
			try {
				if (!statSync(fpath).isFile()) continue;
				const blob = readFileSync(fpath, "utf-8");
				const ticket = parseTicket(blob);
				results.push({ file: fpath, ticket });
			} catch {
				// skip unreadable files
			}
		}
	}
	return results;
}

function readRef(refName: string): LintInput[] {
	const results: LintInput[] = [];
	for (const kind of kinds) {
		const dir = `${planDir}/${kind}`;
		let files: string[];
		try {
			files = lsTreeMd(refName, dir);
		} catch {
			continue;
		}
		for (const f of files) {
			if (!f.endsWith(".md")) continue;
			try {
				const blob = showRef(refName, f);
				const ticket = parseTicket(blob);
				results.push({ file: f, ticket });
			} catch {
				// skip unreadable
			}
		}
	}
	return results;
}

function main(): void {
	let inputs: LintInput[];
	if (ref) {
		inputs = readRef(ref);
	} else {
		inputs = readWorkingTree();
	}

	if (inputs.length === 0) {
		process.exit(0);
	}

	const report = checkBacklog(inputs);

	for (const issue of report.issues) {
		console.log(`${issue.level}: ${issue.file}: ${issue.message}`);
	}

	if (report.errorCount > 0 || report.warningCount > 0) {
		console.log(
			`lint: ${report.errorCount} error(s), ${report.warningCount} warning(s)`,
		);
	}

	if (report.errorCount > 0) {
		process.exit(1);
	}
	process.exit(0);
}

main();
