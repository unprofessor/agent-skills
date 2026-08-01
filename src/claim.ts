import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";

// ---- input type ----

export interface ClaimInput {
	slug: string;
	trunk?: string;
	planDir?: string;
	worktree?: string;
	/** Run git operations relative to this directory (default: process.cwd()). */
	cwd?: string;
}

// ---- locking (flock, interoperable with bash _lock.sh) ----

function gitCommonDir(cwd: string): string {
	const gd = execFileSync("git", ["rev-parse", "--git-common-dir"], {
		encoding: "utf-8",
		cwd,
	})
		.trim()
		.replace(/\/$/, "");
	// git may return a relative path (e.g. '.git') — resolve it against cwd so
	// the lock path is absolute and mkdir/execFileSync work from any cwd.
	return isAbsolute(gd) ? gd : resolve(cwd, gd);
}

function lockPath(cwd: string): string {
	return join(gitCommonDir(cwd), "planr.lock");
}

/**
 * The whole claim operation as a self-contained CommonJS script. Runs in a
 * spawned `flock -s ... node -e` child so the SHARED kernel lock on
 * <git-common-dir>/planr.lock is held by the flock process for the entire
 * operation — the same file and mechanism bash _lock.sh's `planr_lock_shared`
 * uses, so TS and bash scripts serialize against each other.
 *
 * Mirrors bash claim.sh exactly:
 *   1. locate the task file on trunk (git ls-tree + slug match)
 *   2. dependency gate: every depends_on must be status: done on trunk;
 *      refuse with '<slug>(<status>)' blockers otherwise
 *   3. git worktree add -b plan/<slug> <wt> <trunk>
 *   4. flip status: in_progress + updated: <YYYY-MM-DD> in the worktree —
 *      scoped to the frontmatter block, insert-if-absent (bash's sed was
 *      replace-only and unscoped; the port fixes both)
 *   5. commit the flip, print the worktree path (stdout, one line)
 *
 * Inputs arrive via env vars; the worktree path goes to stdout; error text
 * goes to stderr with a non-zero exit.
 */
const CLAIM_SCRIPT = `
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const slug = process.env.PLANR_CLAIM_SLUG || "";
const trunk = process.env.PLANR_CLAIM_TRUNK || "main";
const planDir = process.env.PLANR_CLAIM_PLAN_DIR || ".plan";
const wt = process.env.PLANR_CLAIM_WT || "../wt-" + slug;
const branch = "plan/" + slug;

if (!slug) {
  process.stderr.write("task slug required\\n");
  process.exit(1);
}

function git(args, opts) {
  try {
    return execFileSync("git", args, Object.assign({ encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }, opts || {}));
  } catch (e) {
    // Fail cleanly: emit the last line of git's stderr (e.g. "fatal: a branch
    // named 'plan/x' already exists") instead of a node stack dump.
    const stderr = (e && e.stderr ? String(e.stderr) : "").trim();
    const lines = stderr.split("\\n").filter(function (l) { return l.trim().length > 0; });
    process.stderr.write((lines.length > 0 ? lines[lines.length - 1] : "git failed: " + args.join(" ")) + "\\n");
    process.exit(1);
  }
}

function listMd(ref, dir) {
  try {
    return git(["ls-tree", "-r", "--name-only", ref, "--", dir])
      .split("\\n").map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  } catch (e) {
    return [];
  }
}

// Match a file by its slug: 'NN-<slug>.md'. Equivalent to the bash
// grep -E "/[0-9]+-<slug>\\.md$".
function findTask(files, slug) {
  return files.find(function (f) {
    return f.replace(/^\\d+-/, "").endsWith(slug + ".md");
  });
}

// Split ONLY the first '---\\n...\\n---' frontmatter block (never re-enters on
// a body thematic break), returning the fm lines + the rest of the blob.
function splitFm(blob) {
  if (blob.indexOf("---\\n") !== 0) return null;
  const end = blob.indexOf("\\n---\\n", 4);
  if (end === -1) return null;
  return { fm: blob.slice(4, end), rest: blob.slice(end + 5) };
}

function readStatus(blob) {
  const s = splitFm(blob);
  if (!s) return "";
  for (const l of s.fm.split("\\n")) {
    if (l.indexOf("status:") === 0) return l.slice("status:".length).trim();
  }
  return "";
}

// Parse depends_on the way parseTicket does: inline '[a, b]', a bare string,
// or block-style '\\n  - a' YAML list.
function readDeps(blob) {
  const s = splitFm(blob);
  if (!s) return [];
  const lines = s.fm.split("\\n");
  let deps = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.indexOf("depends_on:") !== 0) continue;
    const val = l.slice("depends_on:".length).trim();
    if (val.indexOf("[") === 0) {
      deps = val.slice(1, -1).split(",").map(function (x) { return x.trim(); })
        .filter(function (x) { return x.length > 0; });
    } else if (val.length > 0 && val !== "[]") {
      deps = [val];
    }
    // block-style continuation lines ('  - item')
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j].match(/^\\s+-\\s+(.+)$/);
      if (m) { deps.push(m[1].trim()); continue; }
      if (lines[j].trim() === "") continue;
      break;
    }
    break;
  }
  return deps;
}

// ---- 1. locate the task file on trunk ----
const taskFile = findTask(listMd(trunk, planDir + "/tasks"), slug);
if (!taskFile) {
  process.stderr.write("no task file for slug '" + slug + "' on " + trunk + "\\n");
  process.exit(1);
}

// ---- 2. dependency gate (authoritative check) ----
const deps = readDeps(git(["show", trunk + ":" + taskFile]));
const blockers = [];
for (const d of deps) {
  let status = "";
  for (const kd of ["epics", "stories", "tasks"]) {
    const df = findTask(listMd(trunk, planDir + "/" + kd), d);
    if (df) {
      status = readStatus(git(["show", trunk + ":" + df]));
      break;
    }
  }
  if (status !== "done") blockers.push(d + "(" + status + ")");
}
if (blockers.length > 0) {
  process.stderr.write("refuse claim: '" + slug + "' has unfinished depends_on: " + blockers.join(" ") + "\\n");
  process.stderr.write("resolve or complete these first, or have the leader update depends_on.\\n");
  process.exit(1);
}

// ---- 3. create the worktree branch off trunk ----
git(["worktree", "add", "-b", branch, wt, trunk]);

// ---- 4. flip status + updated (frontmatter-scoped, insert-if-absent) ----
const d = new Date();
const p = function (n) { return String(n).padStart(2, "0"); };
const date = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());

const wpath = path.resolve(wt);
const fullPath = path.join(wpath, taskFile);
const content = fs.readFileSync(fullPath, "utf-8");
const s = splitFm(content);
if (!s) {
  process.stderr.write("no frontmatter in " + taskFile + "\\n");
  process.exit(1);
}
const lines = s.fm.split("\\n");
let hasStatus = false;
let hasUpdated = false;
const out = [];
for (const line of lines) {
  if (line.indexOf("status:") === 0) {
    out.push("status: in_progress");
    hasStatus = true;
  } else if (line.indexOf("updated:") === 0) {
    out.push("updated: " + date);
    hasUpdated = true;
  } else {
    out.push(line);
  }
}
if (!hasStatus) out.unshift("status: in_progress");
if (!hasUpdated) out.unshift("updated: " + date);
fs.writeFileSync(fullPath, "---\\n" + out.join("\\n") + "\\n---\\n" + s.rest, "utf-8");
git(["add", taskFile], { cwd: wpath });
git(["commit", "-m", "plan: claim " + slug + " (in_progress)"], { cwd: wpath });

process.stdout.write(wt + "\\n");
`;

/**
 * Claim a task: verify its depends_on are all `done` on trunk, create a
 * plan/<slug> worktree branch off trunk, flip the task to in_progress, and
 * commit the flip. Returns the worktree path (one line).
 *
 * The entire operation runs under a SHARED `flock` on
 * <git-common-dir>/planr.lock — the same file and mode bash claim.sh uses
 * (`planr_lock_shared`) — so concurrent writers (new-ticket.sh,
 * merge-task.sh) and readers serialize on a consistent snapshot.
 */
export function claimTask(input: ClaimInput): string {
const slug = input.slug;
const trunk = input.trunk ?? "main";
const planDir = input.planDir ?? ".plan";
const wt = input.worktree ?? `../wt-${slug}`;
const cwd = input.cwd ?? process.cwd();

	const lp = lockPath(cwd);
	mkdirSync(dirname(lp), { recursive: true });

	let out: string;
	try {
		out = execFileSync(
			"flock",
			["-s", lp, process.execPath, "--input-type=commonjs", "-e", CLAIM_SCRIPT],
			{
				encoding: "utf-8",
				cwd,
				// Explicit pipe stdio: with the default, the child's stderr is both
				// inherited (leaks to our stderr) and captured, duplicating error
				// output. Piping captures it once; we re-emit it below.
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					PLANR_CLAIM_SLUG: slug,
					PLANR_CLAIM_TRUNK: trunk,
					PLANR_CLAIM_PLAN_DIR: planDir,
					PLANR_CLAIM_WT: wt,
				},
			},
		);
	} catch (err: unknown) {
		const e = err as {
			stderr?: string | Buffer;
			code?: string;
			status?: number;
		};
		const stderr =
			typeof e.stderr === "string"
				? e.stderr
				: Buffer.isBuffer(e.stderr)
					? e.stderr.toString("utf-8")
					: "";
		if (e.code === "ENOENT") {
			throw new Error(
				"planr: 'flock' (util-linux) is required for safe concurrent access to .plan",
			);
		}
		// Surface the child's stderr verbatim (refusal text, no-task-file
		// message, or git failure output) instead of a node stack dump.
		const msg = stderr.trim();
		throw new Error(
			msg.length > 0 ? msg : `claim failed (exit ${e.status ?? "?"})`,
		);
	}
	return out.trim();
}
