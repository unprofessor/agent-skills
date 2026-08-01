import { execFileSync } from "node:child_process";

// ---- helpers ----

function git(
  args: string[],
  opts?: { cwd?: string; input?: string },
): string {
  return execFileSync("git", args, {
    encoding: "utf-8",
    ...opts,
  });
}

/** Discover the repo toplevel from any working directory. */
function repoRoot(): string {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

/** Default cwd is the repo root (safe from any subdirectory). */
function repoCwd(): string {
  return repoRoot();
}

// ---- public API ----

/** List all .md files under dir at ref (e.g. 'HEAD:.plan'). */
export function lsTreeMd(ref: string, dir: string): string[] {
  const out = git(["ls-tree", "-r", "--name-only", ref, "--", dir]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".md") && l.length > 0);
}

/** Show a single blob at ref:path. */
export function showRef(ref: string, path: string): string {
  return git(["show", `${ref}:${path}`]);
}

/** git worktree add <path> [-b] <branch> [<ref>]. */
export function worktreeAdd(
  path: string,
  branch: string,
  ref?: string,
): void {
  const args = ["worktree", "add"];
  // In case the branch doesn't exist yet (new worktree)
  if (!branchExists(branch)) {
    args.push("-b", branch);
  }
  args.push(path);
  if (ref) args.push(ref);
  git(args, { cwd: repoCwd() });
}

/** git worktree remove <path> [--force]. */
export function worktreeRemove(
  path: string,
  force?: boolean,
): void {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);
  git(args, { cwd: repoCwd() });
}

/** git branch -d|-D <branch>. */
export function branchDelete(
  branch: string,
  force?: boolean,
): void {
  const flag = force ? "-D" : "-d";
  git(["branch", flag, branch], { cwd: repoCwd() });
}

/** git merge --no-ff <branch>. */
export function mergeNoFf(branch: string): void {
  git(["merge", "--no-ff", branch], { cwd: repoCwd() });
}

/** git checkout <branch>. */
export function checkout(branch: string): void {
  git(["checkout", branch], { cwd: repoCwd() });
}

/** git commit [-m <message>] [files...]. */
export function commit(
  message: string,
  files?: string[],
): void {
  const args = ["commit", "-m", message];
  if (files && files.length > 0) args.push("--", ...files);
  git(args, { cwd: repoCwd() });
}

/** git diff <ref1>..<ref2> (or just git diff if only one ref). */
export function diffRefs(ref1: string, ref2: string): string {
  return git(["diff", `${ref1}..${ref2}`], { cwd: repoCwd() });
}

/** git branch --list [<pattern>]. */
export function branchList(pattern?: string): string[] {
  const args = ["branch", "--list"];
  if (pattern) args.push(pattern);
  const out = git(args, { cwd: repoCwd() });
  return out
    .split("\n")
    .map((l) => l.replace(/^[* ] /, "").trim())
    .filter((l) => l.length > 0);
}

/** git worktree list --porcelain. Returns raw porcelain lines (each worktree
 *  block: 'worktree /path', 'HEAD <sha>', 'branch <ref>', etc.) */
export function worktreeList(): string[] {
  const out = git(["worktree", "list", "--porcelain"], { cwd: repoCwd() });
  return out.split("\n").filter((l) => l.length > 0);
}

/** git rev-parse --verify <ref>. Returns the full SHA. */
export function revParseVerify(ref: string): string {
  return git(["rev-parse", "--verify", ref], { cwd: repoCwd() }).trim();
}

// ---- internal (not exported) ----

function branchExists(branch: string): boolean {
  try {
    git(["rev-parse", "--verify", `refs/heads/${branch}`], {
      cwd: repoCwd(),
    });
    return true;
  } catch {
    return false;
  }
}
