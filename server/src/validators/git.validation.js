import { z } from "zod";
import { GIT_LIMITS } from "../../../shared/gitProtocol.js";

const nonEmptyId = z.string().trim().min(1).max(128);
const projectPath = z.string().trim().min(1).max(1024);

export const gitStatusQuerySchema = z.object({
  projectId: nonEmptyId,
  includeTracked: z.enum(["true", "false"]).optional(),
});

export const gitInitSchema = z.object({
  projectId: nonEmptyId,
  defaultBranch: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME).optional(),
  createInitialCommit: z.boolean().optional(),
  createGitignore: z.boolean().optional(),
});

export const gitPublishGithubSchema = z.object({
  projectId: nonEmptyId,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(350).optional(),
  isPrivate: z.boolean().optional(),
  defaultBranch: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME).optional(),
  initialCommitMessage: z.string().trim().max(500).optional(),
  async: z.boolean().optional(),
});

export const gitRemoteSchema = z.object({
  projectId: nonEmptyId,
  repoUrl: z.string().trim().min(1).max(500),
});

export const gitStageSchema = z.object({
  projectId: nonEmptyId,
  files: z.union([z.literal("all"), z.string(), z.array(z.string())]).optional(),
  folder: z.string().trim().min(1).max(512).optional(),
});

export const gitHunkActionSchema = z.object({
  projectId: nonEmptyId,
  filePath: projectPath,
  hunkIndex: z.coerce.number().int().min(0),
});

export const gitDiscardSchema = z.object({
  projectId: nonEmptyId,
  filePath: z.string().trim().optional(),
  isUntracked: z.boolean().optional(),
  includeUntracked: z.boolean().optional(),
  files: z
    .union([
      z.literal("all"),
      z.array(
        z.union([
          z.string(),
          z.object({
            path: projectPath,
            isUntracked: z.boolean().optional(),
          }),
        ]),
      ),
    ])
    .optional(),
});

export const gitIgnoreSchema = z.object({
  projectId: nonEmptyId,
  pattern: z.string().trim().min(1).max(300),
});

export const gitDiffPairQuerySchema = z.object({
  projectId: nonEmptyId,
  filePath: projectPath,
  mode: z.enum(["working", "staged", "commit"]).default("working"),
  commitHash: z.string().trim().min(4).max(64).optional(),
  parentHash: z.string().trim().min(4).max(64).optional(),
  origPath: z.string().trim().max(1024).optional(),
});

export const gitFileAtRefQuerySchema = z.object({
  projectId: nonEmptyId,
  filePath: projectPath,
  ref: z.string().trim().min(1).max(200).default("HEAD"),
});

export const gitCommitSchema = z.object({
  projectId: nonEmptyId,
  message: z.string().trim().min(1).max(GIT_LIMITS.MAX_COMMIT_MSG),
  description: z.string().max(GIT_LIMITS.MAX_COMMIT_MSG).optional(),
  amend: z.boolean().optional(),
  stageAll: z.boolean().optional(),
  pushAfter: z.boolean().optional(),
  syncAfter: z.boolean().optional(),
  authorName: z.string().max(120).optional(),
  authorEmail: z.string().max(200).optional(),
});

export const gitUndoCommitSchema = z.object({
  projectId: nonEmptyId,
  allowPushed: z.boolean().optional(),
});

export const gitAiCommitSchema = z.object({
  projectId: nonEmptyId,
  model: z.string().trim().max(100).optional(),
});

export const gitLogQuerySchema = z.object({
  projectId: nonEmptyId,
  branch: z.string().trim().max(GIT_LIMITS.MAX_BRANCH_NAME).optional(),
  search: z.string().trim().max(200).optional(),
  author: z.string().trim().max(120).optional(),
  filePath: z.string().trim().max(1024).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(GIT_LIMITS.MAX_LOG_LIMIT).default(25),
});

export const gitCommitActionSchema = z.object({
  projectId: nonEmptyId,
});

export const gitResetSchema = z.object({
  projectId: nonEmptyId,
  targetRef: z.string().trim().min(1).max(200).default("HEAD"),
  mode: z.enum(["soft", "mixed", "hard"]).default("mixed"),
});

export const gitCheckoutSchema = z.object({
  projectId: nonEmptyId,
  branch: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME),
  createNew: z.boolean().optional(),
  fromRef: z.string().trim().max(200).optional(),
  stashDirty: z.boolean().optional(),
});

export const gitRenameBranchSchema = z.object({
  projectId: nonEmptyId,
  oldName: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME),
  newName: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME),
});

export const gitDeleteBranchSchema = z.object({
  projectId: nonEmptyId,
  force: z.boolean().optional(),
  deleteRemote: z.boolean().optional(),
});

export const gitMergeSchema = z.object({
  projectId: nonEmptyId,
  sourceBranch: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME),
  mode: z.enum(["merge", "no-ff", "squash"]).default("merge"),
});

export const gitRebaseSchema = z.object({
  projectId: nonEmptyId,
  targetBranch: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME),
});

export const gitProjectOnlySchema = z.object({
  projectId: nonEmptyId,
});

export const gitResolveConflictSchema = z.object({
  projectId: nonEmptyId,
  filePath: projectPath,
  resolution: z.enum(["ours", "theirs", "both", "manual"]),
  manualContent: z.string().max(1024 * 1024).optional(),
});

export const gitRemoteSyncSchema = z.object({
  projectId: nonEmptyId,
  branch: z.string().trim().max(GIT_LIMITS.MAX_BRANCH_NAME).optional(),
  prune: z.boolean().optional(),
  tags: z.boolean().optional(),
  rebase: z.boolean().optional(),
  setUpstream: z.boolean().optional(),
  forceWithLease: z.boolean().optional(),
  async: z.boolean().optional(),
});

export const remoteCheckBodySchema = z.object({
  projectId: nonEmptyId,
  force: z.boolean().optional(),
  branch: z.string().trim().max(GIT_LIMITS.MAX_BRANCH_NAME).optional(),
  silent: z.boolean().optional(),
});

export const gitStashPushSchema = z.object({
  projectId: nonEmptyId,
  message: z.string().trim().max(300).optional(),
  includeUntracked: z.boolean().optional(),
  stagedOnly: z.boolean().optional(),
});

export const gitCreateTagSchema = z.object({
  projectId: nonEmptyId,
  name: z.string().trim().min(1).max(GIT_LIMITS.MAX_TAG_NAME),
  targetRef: z.string().trim().max(200).optional(),
  message: z.string().trim().max(1000).optional(),
  pushAfter: z.boolean().optional(),
});

export const gitDeleteTagSchema = z.object({
  projectId: nonEmptyId,
  deleteRemote: z.boolean().optional(),
});

export const gitCreatePrSchema = z.object({
  projectId: nonEmptyId,
  title: z.string().trim().min(1).max(256),
  body: z.string().max(10000).optional(),
  head: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME),
  base: z.string().trim().min(1).max(GIT_LIMITS.MAX_BRANCH_NAME).default("main"),
  draft: z.boolean().optional(),
});

export const gitCommandSchema = z
  .object({
    projectId: nonEmptyId,
    input: z.string().trim().min(1).max(1000).optional(),
    command: z.string().trim().min(1).max(120).optional(),
    args: z.array(z.string().max(400)).max(25).optional(),
  })
  .refine((value) => Boolean(value.input || value.command), {
    message: "Git command input is required",
  });
