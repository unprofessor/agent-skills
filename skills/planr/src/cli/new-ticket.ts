#!/usr/bin/env node
// CLI entry for new-ticket.sh — scaffold a new ticket file.
import { createTicket } from "../new-ticket.js";
import { checkBacklog, type LintInput } from "../lint.js";
import { parseTicket } from "../ticket.js";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const planDir = process.env.PLANR_DIR ?? ".plan";

function usage(): never {
	console.error(`Usage: new-ticket.sh <kind> <slug> <title> [parent-slug]`);
	process.exit(1);
}

function main(): void {
	const kind = args[0];
	const slug = args[1];
	const title = args[2];
	const parent = args[3] ?? null;

	if (!kind || !slug || !title) usage();

	// Resolve the here directory (where the shim lives) to find templates.
	// process.argv[1] is the .cjs/.js path. Walk up from dist/cli/ to repo root.
	const scriptPath = process.argv[1];
	const here = resolve(
		scriptPath,
		"..", // cli
		"..", // dist
		"..", // repo root
	);

	// Templates are at <repo-root>/skills/planr/templates/ (part of the skill)
	const templatesDir = join(here, "skills", "planr", "templates");
	// Fallback: try <repo-root>/templates (for development)
	const _templatesDir = existsSync(templatesDir)
		? templatesDir
		: join(here, "templates");

	let path: string;
	try {
		path = createTicket(kind, slug, title, parent, planDir, _templatesDir);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(msg);
		process.exit(1);
	}

	// Informational lint run on stderr — pre-existing errors don't block creation.
	try {
		runInformationalLint(planDir);
	} catch {
		// lint errors are informational; never block ticket creation
	}

	// stdout: exactly the path (one line)
	console.log(path);
}

function runInformationalLint(planDir: string): void {
	const kinds = ["epics", "stories", "tasks"] as const;
	const inputs: LintInput[] = [];

	for (const kd of kinds) {
		const dir = join(planDir, kd);
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
			const fpath = join(planDir, kd, entry);
			try {
				if (!statSync(fpath).isFile()) continue;
				const blob = readFileSync(fpath, "utf-8");
				const ticket = parseTicket(blob);
				inputs.push({ file: fpath, ticket });
			} catch {
				// skip unreadable files
			}
		}
	}

	if (inputs.length === 0) return;

	const report = checkBacklog(inputs);

	for (const issue of report.issues) {
		process.stderr.write(`${issue.level}: ${issue.file}: ${issue.message}\n`);
	}

	if (report.errorCount > 0 || report.warningCount > 0) {
		process.stderr.write(
			`lint: ${report.errorCount} error(s), ${report.warningCount} warning(s)\n`,
		);
	}
}

main();
