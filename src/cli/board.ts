#!/usr/bin/env node
// CLI entry for board.sh — reads trunk tickets + in-flight branches,
// renders the board view.
import { parseTicket } from "../ticket.js";
import { renderBoard } from "../board.js";
import type { BranchStatus } from "../board.js";
import { lsTreeMd, showRef, branchList } from "../git.js";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const trunk = process.env.PLANR_TRUNK ?? "main";
const planDir = process.env.PLANR_DIR ?? ".plan";
const ref = args[0] ?? trunk;

const kinds = ["epics", "stories", "tasks"] as const;

function readWorkingTree() {
	const results = [];
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
				results.push(parseTicket(blob));
			} catch {
				// skip unreadable
			}
		}
	}
	return results;
}

function readRef(refName: string) {
	const results = [];
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
				results.push(parseTicket(blob));
			} catch {
				// skip unreadable
			}
		}
	}
	return results;
}

function gitSilent(args: string[]): string {
	return execFileSync("git", args, {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "ignore"],
	});
}

function lsTreeMdSilent(ref: string, dir: string): string[] {
	const out = gitSilent(["ls-tree", "-r", "--name-only", ref, "--", dir]);
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.endsWith(".md") && l.length > 0);
}

function showRefSilent(ref: string, path: string): string {
	return gitSilent(["show", `${ref}:${path}`]);
}

function readInFlightBranches(): BranchStatus[] {
	let branches: string[];
	try {
		branches = branchList("plan/*");
	} catch {
		return [];
	}

	const results: BranchStatus[] = [];
	for (const b of branches) {
		const slug = b.replace(/^plan\//, "");
		let files: string[];
		try {
			files = lsTreeMdSilent(b, `${planDir}/tasks`);
		} catch {
			continue;
		}
		const taskFile = files.find((f) => {
			const pattern = new RegExp(`/[0-9]+-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`);
			return pattern.test(f);
		});
		if (!taskFile) {
			results.push({ branch: b, status: "(no task file)", slug });
			continue;
		}
		try {
			const blob = showRefSilent(b, taskFile);
			const ticket = parseTicket(blob);
			results.push({ branch: b, status: ticket.status, slug });
		} catch {
			results.push({ branch: b, status: "(unreadable)", slug });
		}
	}
	return results;
}

function main(): void {
	const trunkTickets = ref ? readRef(ref) : readWorkingTree();
	const branchStatuses = readInFlightBranches();
	const output = renderBoard({ trunkTickets, branchStatuses });
	if (output) process.stdout.write(output);
}

main();
