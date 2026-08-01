import { parseTicket } from "./ticket.js";
import { extractSection } from "./parse.js";
import {
	showRef,
	diffRefs,
	worktreeList,
	revParseVerify,
	lsTreeMd,
} from "./git.js";

export interface ReviewInput {
	slug: string;
	trunk: string;
	planDir: string;
}

/**
 * Generate the full review brief for a task on a plan/<slug> branch.
 * Pure: takes all IO deps via the ReviewInput config. Returns the complete
 * output matching review.sh format.
 */
export function generateReviewBrief(input: ReviewInput): string {
	const { slug, trunk, planDir } = input;
	const branch = `plan/${slug}`;

	// Verify branch exists
	try {
		revParseVerify(branch);
	} catch {
		throw new Error(`no such branch: ${branch}`);
	}

	// Find the task file on the branch (matches /NN-slug.md) like bash review.sh
	const taskFiles = lsTreeMd(branch, `${planDir}/tasks`);
	const taskPattern = new RegExp(`/[0-9]+-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.md$`);
	const taskFile = taskFiles.find((f) => taskPattern.test(f));
	if (!taskFile) {
		throw new Error(`no task file for '${slug}' on ${branch}`);
	}

	// Locate worktree for this branch
	let worktreePath: string | undefined;
	const rawLines = worktreeList();
	let currentWorktree = "";
	for (const line of rawLines) {
		if (line.startsWith("worktree ")) {
			currentWorktree = line.slice("worktree ".length);
		} else if (
			line.startsWith("branch ") &&
			line === `branch refs/heads/${branch}` &&
			currentWorktree
		) {
			worktreePath = currentWorktree;
			break;
		}
	}

	const displayWt =
		worktreePath ?? `(none — checkout ${branch} to review)`;

	// Read the task file from the branch
	const blob = showRef(branch, taskFile);
	const ticket = parseTicket(blob);

	// Extract acceptance and validation sections from raw body
	const acceptance = extractSection(ticket.raw, "Acceptance");
	const validationRaw = extractSection(ticket.raw, "Validation");
	// Strip blank lines from validation (matching bash review.sh sed)
	const validation = validationRaw
		.split("\n")
		.filter((line: string) => line.trim() !== "")
		.join("\n");

	// Diff
	const diff = diffRefs(trunk, branch);

	// Reviewer guidance (static heredoc from review.sh)
	const guidance = `--- reviewer guidance ---
You are an independent reviewer in fresh context. Do NOT trust the worker's
self-validation; re-check everything yourself.

1. Read ## Acceptance above and the diff.
2. In the worktree, RUN the acceptance checks yourself (tests, commands,
   manual verification).
3. Edit ONLY the task file (never code). Add a ## Review section:
       ## Review
       verdict: approved          # or: changes-requested
       reviewer: <your id>
       date: <YYYY-MM-DD>
       <what you re-checked and the result>
4. If approved: leave status: review, commit, hand back to the leader.
5. If changes-requested: also flip status: in_progress, record concretely what
   failed, commit, hand back. The worker will be re-dispatched.`;

	return [
		`branch:    ${branch}`,
		`task:      ${taskFile}`,
		`worktree:  ${displayWt}`,
		"",
		"--- acceptance ---",
		acceptance,
		"",
		"--- validation (worker self-check) ---",
		validation || "",
		"",
		`--- diff vs ${trunk} ---`,
		diff,
		"",
		guidance,
		"",
	].join("\n");
}
