import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "node:fs";
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

// ---- locking (flock, interoperable with bash _lock.sh) ----

function gitCommonDir(): string {
	return execFileSync("git", ["rev-parse", "--git-common-dir"], {
		encoding: "utf-8",
	}).trim();
}

function lockPath(): string {
	const gd = gitCommonDir();
	return join(gd, "planr.lock");
}

/**
 * The allocate-prefix + write + verify critical section, as a self-contained
 * CommonJS script. Runs in a spawned `flock ... node -e` child so the kernel
 * lock is held by the flock process for the whole section. The kernel lock is
 * attached to the flock process, so the child does not need to inherit any fd
 * (fds opened in the parent are not inherited by Node children anyway).
 * Inputs arrive via env vars; the created path goes to stdout; errors go to
 * stderr with a non-zero exit.
 */
const LOCKED_WRITE_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.PLANR_LOCK_DIR;
const slug = process.env.PLANR_LOCK_SLUG;
const content = process.env.PLANR_LOCK_CONTENT;

let highest = 0;
if (fs.existsSync(dir)) {
  for (const e of fs.readdirSync(dir)) {
    const m = e.match(/^(\\d+)-/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > highest) highest = n;
    }
  }
}

const nn = String(highest + 1).padStart(2, "0");
const p = path.join(dir, nn + "-" + slug + ".md");

if (fs.existsSync(p)) {
  process.stderr.write("already exists: " + p + "\\n");
  process.exit(2);
}

fs.writeFileSync(p, content, "utf-8");

const entries = fs.readdirSync(dir);
const count = entries.filter((e) => e.startsWith(nn + "-")).length;
if (count !== 1) {
  process.stderr.write("internal error: prefix " + nn + " is shared by " + count + " files in " + dir + " after creating " + p + "\\n");
  process.exit(3);
}

process.stdout.write(p);
`;

/**
 * Allocate the next sort-hint prefix and write the ticket file under an
 * exclusive `flock` on <git-common-dir>/planr.lock — the SAME file and
 * mechanism bash _lock.sh uses, so TS and bash writers (new-ticket.sh,
 * merge-task.sh) serialize against each other. (An O_EXCL mutex file on a
 * different path cannot coordinate with advisory flock: bash's
 * \`exec 9>"$lf"\` leaves the file on disk, so existence-based locking on the
 * same path would always EEXIST.) The spawned flock child runs in the same
 * cwd/repo, so it operates on the right git-common-dir lock file.
 */
function lockedAllocateAndWrite(
	dir: string,
	slug: string,
	content: string,
): string {
	const lp = lockPath();
	mkdirSync(dirname(lp), { recursive: true });

	let result: string;
	try {
		result = execFileSync(
			"flock",
			[
				"-x",
				lp,
				process.execPath,
				"--input-type=commonjs",
				"-e",
				LOCKED_WRITE_SCRIPT,
			],
			{
				encoding: "utf-8",
				env: {
					...process.env,
					PLANR_LOCK_DIR: dir,
					PLANR_LOCK_SLUG: slug,
					PLANR_LOCK_CONTENT: content,
				},
			},
		);
	} catch (err: unknown) {
		const e = err as {
			stderr?: string | Buffer;
			code?: string;
			status?: number;
		};
		const stderr = typeof e.stderr === "string" ? e.stderr : "";
		const lines = stderr
			.trim()
			.split("\n")
			.filter((l) => l.length > 0);
		// Our child exits 2 (already exists) / 3 (prefix collision) with a
		// single clean message on stderr — surface exactly that (matches the
		// bash output format). Unexpected child crashes (e.g. EACCES) fall
		// through to a generic failure instead of a node stack dump.
		if ((e.status === 2 || e.status === 3) && lines.length > 0) {
			throw new Error(lines[lines.length - 1]!.trim());
		}
		if (e.code === "ENOENT") {
			throw new Error(
				"planr: 'flock' (util-linux) is required for safe concurrent access to .plan",
			);
		}
		throw new Error(
			`flock/child failed (exit ${e.status ?? "?"}): ${
				lines.length > 0 ? lines[lines.length - 1]!.trim() : String(err)
			}`,
		);
	}
	return result.trim();
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

	// Allocate prefix + write under an exclusive flock on planr.lock — the
	// same file bash _lock.sh locks, so TS and bash writers serialize.
	return lockedAllocateAndWrite(dir, slug, content);
}

// ---- helpers ----

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
