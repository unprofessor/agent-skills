import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { parseTicket } from "./ticket.js";
import { extractLastReviewVerdict } from "./parse.js";

// ---- input type ----

export interface MergeInput {
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

// ---- git helpers (read-only, used for the guards) ----

function git(args: string[], opts: { cwd?: string } = {}): string {
	return execFileSync("git", args, {
		encoding: "utf-8",
		...opts,
	});
}

/** List .md files under dir at ref, exactly like bash `git ls-tree -r --name-only`. */
function listMd(ref: string, dir: string, cwd: string): string[] {
	try {
		return git(["ls-tree", "-r", "--name-only", ref, "--", dir], { cwd })
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
	} catch {
		return [];
	}
}

/** Match a task file by its slug: 'NN-<slug>.md' (bash grep -E "/[0-9]+-<slug>\\.md$"). */
function findTask(files: string[], slug: string): string | undefined {
	const re = new RegExp(
		`/[0-9]+-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`,
	);
	return files.find((f) => re.test(f));
}

/**
 * The whole merge mutation as a self-contained CommonJS script. Runs in a
 * spawned `flock -x ... node -e` child so the EXCLUSIVE kernel lock on
 * <git-common-dir>/planr.lock is held by the flock process for the entire
 * operation — the same file and mode bash merge-task.sh's
 * `planr_lock_exclusive` uses, so TS and bash writers serialize against
 * each other.
 *
 * Mirrors bash merge-task.sh exactly:
 *   1. git checkout <trunk>
 *   2. git merge --no-ff <branch> -m "plan: merge <slug>"; on failure list
 *      conflicted files (git diff --name-only --diff-filter=U), git merge
 *      --abort, print the merge log + rebase guidance for the worker, and
 *      exit 1 — leaving worktree + branch intact
 *   3. on success flip status: done + updated: <YYYY-MM-DD> in the merged
 *      task file — scoped to the frontmatter block, insert-if-absent (bash's
 *      sed was replace-only and unscoped; the port fixes both)
 *   4. commit the flip, remove the worktree, delete the branch
 *   5. print "merged plan/<slug> into <trunk>; <slug> done" (stdout)
 *
 * Inputs arrive via env vars; success text goes to stdout; error text goes
 * to stderr with a non-zero exit.
 */
const MERGE_SCRIPT = `
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const slug = process.env.PLANR_MERGE_SLUG || "";
const trunk = process.env.PLANR_MERGE_TRUNK || "main";
const planDir = process.env.PLANR_MERGE_PLAN_DIR || ".plan";
const wt = process.env.PLANR_MERGE_WT || "../wt-" + slug;
const taskFile = process.env.PLANR_MERGE_TASK_FILE || "";
const branch = "plan/" + slug;

if (!slug || !taskFile) {
  process.stderr.write("merge-task: missing input\\n");
  process.exit(1);
}

function git(args, opts) {
  try {
    return execFileSync("git", args, Object.assign({ encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }, opts || {}));
  } catch (e) {
    // Fail cleanly: emit the last line of git's stderr instead of a node stack dump.
    const stderr = (e && e.stderr ? String(e.stderr) : "").trim();
    const lines = stderr.split("\\n").filter(function (l) { return l.trim().length > 0; });
    process.stderr.write((lines.length > 0 ? lines[lines.length - 1] : "git failed: " + args.join(" ")) + "\\n");
    process.exit(1);
  }
}

// ---- 1. checkout trunk ----
git(["checkout", trunk]);

// ---- 2. merge --no-ff (capture the log for the conflict path) ----
let mergeLog = "";
try {
  mergeLog = execFileSync("git", ["merge", "--no-ff", branch, "-m", "plan: merge " + slug], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
} catch (e) {
  const log = String((e && e.stdout ? e.stdout : "") + (e && e.stderr ? e.stderr : "")).trim();
  // list conflicted files while the merge is still in progress (bash order:
  // diff first, then abort)
  let conflicted = "";
  try {
    conflicted = execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (_) { /* no unmerged files — fine */ }
  try { execFileSync("git", ["merge", "--abort"], { stdio: "ignore" }); } catch (_) { /* nothing to abort */ }
  process.stderr.write((mergeLog + (log.length > 0 ? "\\n" + log : "")).trim() + "\\n\\n");
  process.stderr.write("merge conflict in: " + (conflicted || "<unknown>") + "\\n\\n");
  process.stderr.write("The worker must rebase onto fresh trunk and resolve:\\n");
  process.stderr.write("  cd " + wt + "\\n");
  process.stderr.write("  git rebase " + trunk + "   # resolve conflicts, git rebase --continue\\n");
  process.stderr.write("  # then re-run: scripts/merge-task.sh " + slug + "\\n");
  process.exit(1);
}

// ---- 3. flip status: done + updated (frontmatter-scoped, insert-if-absent) ----
const d = new Date();
const p = function (n) { return String(n).padStart(2, "0"); };
const date = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());

// Split ONLY the first '---\\n...\\n---' frontmatter block (never re-enters on
// a body thematic break), returning the fm lines + the rest of the blob.
function splitFm(blob) {
  if (blob.indexOf("---\\n") !== 0) return null;
  const end = blob.indexOf("\\n---\\n", 4);
  if (end === -1) return null;
  return { fm: blob.slice(4, end), rest: blob.slice(end + 5) };
}

const fullPath = path.resolve(taskFile);
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
    out.push("status: done");
    hasStatus = true;
  } else if (line.indexOf("updated:") === 0) {
    out.push("updated: " + date);
    hasUpdated = true;
  } else {
    out.push(line);
  }
}
if (!hasStatus) out.unshift("status: done");
if (!hasUpdated) out.unshift("updated: " + date);
fs.writeFileSync(fullPath, "---\\n" + out.join("\\n") + "\\n---\\n" + s.rest, "utf-8");
git(["add", taskFile]);
git(["commit", "-m", "plan: mark " + slug + " done"]);

// ---- 4. cleanup: remove worktree, delete branch (tolerate failures like
// bash's '|| true' — raw execFileSync here, NOT the exiting git() helper,
// so a missing worktree/branch cannot kill the child) ----
try { execFileSync("git", ["worktree", "remove", wt], { stdio: "ignore" }); } catch (_) { /* already gone */ }
try { execFileSync("git", ["branch", "-d", branch], { stdio: "ignore" }); } catch (_) { /* already gone */ }

process.stdout.write("merged " + branch + " into " + trunk + "; " + slug + " done\\n");
`;

/**
 * Merge a reviewed-and-approved task branch into trunk.
 *
 * Guards (read from the immutable plan/<slug> branch, exact bash messages):
 *   - the plan/<slug> branch must exist
 *   - the task file on the branch must have status: review
 *   - the LAST ## Review block's verdict must be 'approved' (trimmed;
 *     extractLastReviewVerdict handles trailing whitespace, the bash
 *     untrimmed-verdict silent-failure mode)
 *
 * Then, under an EXCLUSIVE `flock` on <git-common-dir>/planr.lock (same file
 * and mode as bash `planr_lock_exclusive`), checks out trunk, merges the
 * branch with --no-ff, flips the task to status: done on trunk, removes the
 * worktree, and deletes the branch. On merge conflict it aborts the merge,
 * prints the rebase guidance, and leaves the worktree + branch intact for the
 * worker to rebase.
 *
 * Returns the success line ("merged plan/<slug> into <trunk>; <slug> done").
 * Throws Error with the exact refusal / conflict text otherwise.
 */
export function mergeTask(input: MergeInput): string {
	const slug = input.slug;
	const trunk = input.trunk ?? "main";
	const planDir = input.planDir ?? ".plan";
	const wt = input.worktree ?? `../wt-${slug}`;
	const cwd = input.cwd ?? process.cwd();
	const branch = `plan/${slug}`;

	// ---- 1. the branch must exist ----
	try {
		git(["rev-parse", "--verify", `refs/heads/${branch}`], { cwd });
	} catch {
		throw new Error(`no such branch: ${branch}`);
	}

	// ---- 2. locate the task file on the branch ----
	const taskFile = findTask(listMd(branch, `${planDir}/tasks`, cwd), slug);
	if (!taskFile) {
		throw new Error(`no task file for '${slug}' on ${branch}`);
	}

	// ---- 3. parse status + verdict from the branch blob ----
	const blob = git(["show", `${branch}:${taskFile}`], { cwd });
	const ticket = parseTicket(blob);
	const status = ticket.status;
	const verdict = extractLastReviewVerdict(ticket.raw);

	// ---- 4. guards (exact bash messages) ----
	if (status !== "review") {
		throw new Error(
			`refuse merge: task '${slug}' status is '${status}', must be 'review'.\n` +
				"the worker must self-validate against ## Acceptance (record ## Validation) and set status: review.",
		);
	}
	if (verdict !== "approved") {
		throw new Error(
			`refuse merge: no approved review verdict on '${slug}' (found: '${verdict ?? "none"}').\n` +
				`assign a reviewer: scripts/review.sh ${slug}`,
		);
	}

	// ---- 5. exclusive-lock mutation (checkout + merge + flip + cleanup) ----
	const lp = lockPath(cwd);
	mkdirSync(dirname(lp), { recursive: true });

	let out: string;
	try {
		out = execFileSync(
			"flock",
			["-x", lp, process.execPath, "--input-type=commonjs", "-e", MERGE_SCRIPT],
			{
				encoding: "utf-8",
				cwd,
				// Explicit pipe stdio: with the default, the child's stderr is both
				// inherited (leaks to our stderr) and captured, duplicating error
				// output. Piping captures it once; we re-emit it below.
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					PLANR_MERGE_SLUG: slug,
					PLANR_MERGE_TRUNK: trunk,
					PLANR_MERGE_PLAN_DIR: planDir,
					PLANR_MERGE_WT: wt,
					PLANR_MERGE_TASK_FILE: taskFile,
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
		// Surface the child's stderr verbatim (conflict guidance, merge log, or
		// git failure output) instead of a node stack dump.
		const msg = stderr.trim();
		throw new Error(
			msg.length > 0 ? msg : `merge failed (exit ${e.status ?? "?"})`,
		);
	}
	return out.trim();
}
