// Stub — re-exports git wrappers so esbuild bundles src/git.ts.
// This file will be replaced by the real CLI entries in cli-shims task.
export {
  lsTreeMd,
  showRef,
  worktreeAdd,
  worktreeRemove,
  branchDelete,
  mergeNoFf,
  checkout,
  commit,
  diffRefs,
  branchList,
  worktreeList,
  revParseVerify,
} from "../git.js";
