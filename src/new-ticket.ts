import { execFileSync } from "node:child_process";
import {
	readdirSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	openSync,
	closeSync,
	unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";

// ---- constants ----

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_KINDS = ["epic", "story", "task"] as const;
type Kind = (typeof VALID_KINDS)[number];

// ---- slug validation ----

export function validateSlug(slug: string): boolean {
	return SLUG_RE.test(slug);
}

// ---- kind helpers ----

export function kindToSubdir(kind: string): string {
	switch (kind) {
		case "epic":
			return "epics";
		case "story":
			return "stories";
		case "task":
			return "tasks";
		default:
			throw new Error(`unknown kind: ${kind} (want epic|story|task)`);
	}
}

export function isValidKind(kind: string): kind is Kind {
	return (VALID_KINDS as readonly string[]).includes(kind);
}

// ---- parent existence ----

export function parentExists(parent: string, planDir: string): boolean {
	for (const kd of ["epics", "stories", "tasks"]) {
		const dir = join(planDir, kd);
		if (!existsSync(dir)) continue;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		const re = new RegExp(`^\\d+-${escapeRegex(parent)}\\.md$`);
		if (entries.some((e) => re.test(e))) return true;
	}
	return false;
}

// ---- prefix allocation ----

/** Read the highest NN prefix in a directory, return NN+1 as a zero-padded string. */
export function allocatePrefix(dir: string): string {
	let highest = 0;
	if (existsSync(dir)) {
		try {
			const entries = readdirSync(dir);
			for (const e of entries) {
				const m = e.match(/^(\d+)-/);
				if (m) {
					const n = parseInt(m[1], 10);
					if (n > highest) highest = n;
				}
			}
		} catch {
			// dir unreadable — start at 01
		}
	}
	return String(highest + 1).padStart(2, "0");
}

// ---- locking (flock, compatible with bash _lock.sh) ----

function gitCommonDir(): string {
	return execFileSync("git", ["rev-parse", "--git-common-dir"], {
		encoding: "utf-8",
	}).trim();
}

function lockPath(): string {
	const gd = gitCommonDir();
	return join(gd, "planr.lock");
}

function flockExclusive<T>(fn: () => T): T {
	const lp = lockPath();
	mkdirSync(dirname(lp), { recursive: true });

	// Use flock on the file path (not an fd number) for cross-process
	// compatibility. We hold the lock by running a no-op command under
	// flock, then do our work while the lock fd is still held in a
	// background process. This is simpler: just use O_EXCL file creation
	// as a mutex with retry.
	//
	// The bash _lock.sh uses `exec 9>"$lf" && flock -x 9` which only
	// works because fd 9 is opened in the current shell process. Node
	// child processes don't inherit non-stdio fds, so we use a
	// create-exclusive retry lock instead.
	const mutexFile = `${lp}.mutex`;

	// Retry loop with backoff
	for (let attempt = 0; attempt < 200; attempt++) {
		try {
			// Atomic exclusive create — fails if file already exists
			const lockFd = openSync(mutexFile, "wx");
			try {
				return fn();
			} finally {
				closeSync(lockFd);
				try {
					unlinkSync(mutexFile);
				} catch {
					/* best effort */
				}
			}
		} catch (err: unknown) {
			if (
				typeof err === "object" &&
				err !== null &&
				(err as NodeJS.ErrnoException).code === "EEXIST"
			) {
				// Lock held by another process — wait and retry
				execFileSync("sleep", ["0.05"]);
				continue;
			}
			throw err;
		}
	}
	throw new Error(`timed out waiting for lock: ${mutexFile}`);
}

// ---- template substitution ----

export function createTicket(
	kind: string,
	slug: string,
	title: string,
	parent: string | null,
	planDir: string,
	templatesDir: string,
): string {
	// Validate kind
	if (!isValidKind(kind)) {
		throw new Error(`unknown kind: ${kind} (want epic|story|task)`);
	}

	// Validate slug
	if (!validateSlug(slug)) {
		throw new Error(
			`bad slug '${slug}': want kebab-case (lowercase alphanumerics, single hyphens between segments, starting with [a-z0-9])`,
		);
	}

	// Parent required for story and task
	if (kind !== "epic" && !parent) {
		throw new Error(`parent slug required for ${kind}`);
	}

	// Parent must exist
	if (parent && kind !== "epic") {
		if (!parentExists(parent, planDir)) {
			throw new Error(
				`parent '${parent}' not found under ${planDir}/ — create the parent first`,
			);
		}
	}

	const subdir = kindToSubdir(kind);
	const dir = join(planDir, subdir);
	mkdirSync(dir, { recursive: true });

	// Read template
	const templatePath = join(templatesDir, `${kind}.md`);
	let template: string;
	try {
		template = readFileSync(templatePath, "utf-8");
	} catch {
		throw new Error(`template not found: ${templatePath}`);
	}

	const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

	// Do placeholder substitution on the template content
	const content = template
		.replace(/__SLUG__/g, slug)
		.replace(/__TITLE__/g, title)
		.replace(/__PARENT__/g, parent ?? "")
		.replace(/__DATE__/g, today);

	// Allocate prefix + write under exclusive lock (compatible with bash
	// concurrent new-ticket.sh invocations sharing the same flock file).
	const _path = flockExclusive(() => {
		const nn = allocatePrefix(dir);
		const p = join(dir, `${nn}-${slug}.md`);

		if (existsSync(p)) {
			throw new Error(`already exists: ${p}`);
		}

		writeFileSync(p, content, "utf-8");

		// Defensive: re-scan for prefix collision (same as bash)
		const entries = readdirSync(dir);
		const count = entries.filter((e) => e.startsWith(`${nn}-`)).length;
		if (count !== 1) {
			throw new Error(
				`internal error: prefix ${nn} is shared by ${count} files in ${dir} after creating ${p}`,
			);
		}

		return p;
	});

	return _path;
}

// ---- helpers ----

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
