import { z } from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const suiteRestoreRequest = z.object({expectedHeadId:z.string().min(1),expectedSuiteHash:hash,expectedSourceHash:hash,expectedWorkspaceRevision:z.number().int().nonnegative(),requestId:z.string().min(1).max(160)}).strict();
export const suiteCheckRequest = z.object({expectedSourceHash:hash,runner:z.enum(['playwright','cypress']).default('playwright'),executionMode:z.literal('full').default('full'),requestId:z.string().min(1).max(160)}).strict();
