import { z } from "zod";
import { SNAPSHOT_VCS_LIMITS } from "../../../shared/snapshotVcsProtocol.js";

const projectPath = z.string().trim().min(1).max(1024);

export const snapshotStatusQuerySchema = z.object({
  includeUnchanged: z.enum(["true", "false"]).optional(),
});

export const snapshotStageSchema = z.object({
  files: z.union([z.literal("all"), z.string(), z.array(z.string())]).optional(),
  folder: z.string().trim().min(1).max(512).optional(),
});

export const snapshotDiscardSchema = z.object({
  files: z.union([z.literal("all"), z.string(), z.array(z.string())]).default("all"),
});

export const snapshotDiffPairQuerySchema = z.object({
  filePath: projectPath,
  baseSnapshotId: z.string().trim().max(128).optional(),
  targetSnapshotId: z.string().trim().max(128).optional(),
  origPath: z.string().trim().max(1024).optional(),
});

export const snapshotCompareQuerySchema = z.object({
  baseSnapshotId: z.string().trim().min(1).max(128),
  targetSnapshotId: z.string().trim().min(1).max(128).default("WORKING_TREE"),
});

export const snapshotListQuerySchema = z.object({
  branchId: z.string().trim().max(128).optional(),
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(SNAPSHOT_VCS_LIMITS.MAX_TAG_LENGTH).optional(),
  pinnedOnly: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const snapshotCaptureSchema = z.object({
  label: z.string().trim().min(1).max(SNAPSHOT_VCS_LIMITS.MAX_LABEL_LENGTH),
  message: z.string().max(SNAPSHOT_VCS_LIMITS.MAX_MESSAGE_LENGTH).optional(),
  tag: z.string().trim().max(SNAPSHOT_VCS_LIMITS.MAX_TAG_LENGTH).optional().nullable(),
  stageAll: z.boolean().optional(),
  branchId: z.string().trim().max(128).optional(),
});

export const snapshotUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(SNAPSHOT_VCS_LIMITS.MAX_LABEL_LENGTH).optional(),
    commitMessage: z.string().max(SNAPSHOT_VCS_LIMITS.MAX_MESSAGE_LENGTH).optional(),
    isPinned: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.label !== undefined ||
      data.commitMessage !== undefined ||
      data.isPinned !== undefined,
    { message: "Provide at least one field to update" },
  );

export const snapshotFileQuerySchema = z.object({
  path: projectPath,
});

export const snapshotRestoreFileSchema = z.object({
  filePath: projectPath,
});

export const snapshotRestoreSchema = z.object({
  dirtyPolicy: z
    .enum([
      "AUTO_BACKUP",
      "DISCARD_DIRTY",
      "FAIL_IF_DIRTY",
      "auto_backup",
      "discard",
      "fail",
    ])
    .optional(),
  autoBackup: z.boolean().optional(),
  customLabel: z.string().trim().max(SNAPSHOT_VCS_LIMITS.MAX_LABEL_LENGTH).optional(),
});

export const snapshotCreateBranchSchema = z.object({
  name: z.string().trim().min(1).max(SNAPSHOT_VCS_LIMITS.MAX_BRANCH_NAME),
  fromSnapshotId: z.string().trim().max(128).optional(),
  description: z.string().max(500).optional(),
  checkout: z.boolean().optional(),
});

export const snapshotCheckoutBranchSchema = z.object({
  dirtyPolicy: z
    .enum([
      "AUTO_BACKUP",
      "DISCARD_DIRTY",
      "FAIL_IF_DIRTY",
      "auto_backup",
      "discard",
      "fail",
    ])
    .optional(),
});

export const snapshotUpdateBranchSchema = z.object({
  name: z.string().trim().min(1).max(SNAPSHOT_VCS_LIMITS.MAX_BRANCH_NAME).optional(),
  description: z.string().max(500).optional(),
});

export const snapshotMergeBranchSchema = z.object({
  sourceBranchId: z.string().trim().min(1).max(128),
  targetBranchId: z.string().trim().max(128).optional(),
  message: z.string().max(SNAPSHOT_VCS_LIMITS.MAX_MESSAGE_LENGTH).optional(),
  dirtyPolicy: z
    .enum([
      "AUTO_BACKUP",
      "DISCARD_DIRTY",
      "FAIL_IF_DIRTY",
      "DISCARD",
      "auto_backup",
      "discard",
      "fail",
    ])
    .optional(),
  dirtyStrategy: z
    .enum([
      "AUTO_BACKUP",
      "DISCARD_DIRTY",
      "FAIL_IF_DIRTY",
      "DISCARD",
      "auto_backup",
      "discard",
      "fail",
    ])
    .optional(),
  resolutions: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.object({
          resolution: z.enum(["ours", "theirs", "both", "manual"]),
          manualContent: z.string().max(1024 * 1024).optional(),
        }),
      ]),
    )
    .optional(),
});

export const snapshotCreateTagSchema = z.object({
  name: z.string().trim().min(1).max(SNAPSHOT_VCS_LIMITS.MAX_TAG_LENGTH),
  description: z.string().max(500).optional(),
  color: z.string().trim().max(32).optional(),
});

export const snapshotAiSummarySchema = z.object({
  model: z.string().trim().max(100).optional(),
});

export const snapshotGcSchema = z.object({
  graceWindowMs: z.coerce.number().int().min(0).optional(),
});
