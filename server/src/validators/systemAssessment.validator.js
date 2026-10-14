import { z } from 'zod';
import { ServiceError } from '../utils/serviceError.js';

const relativePath = z.string().min(1).max(512).refine(value => !value.includes('\\') && !value.split('/').includes('..') && !/^(?:\/|[a-z]:|https?:)/i.test(value), 'Repository-relative path required');
const scope = z.object({ root: relativePath, sourceDirectory: relativePath }).strict();
export const assessmentRequest = z.object({ testFiles: z.array(relativePath).min(1).max(20), excludedTests: z.array(z.object({filePath:relativePath,reason:z.string()}).strict()).optional(), runner: z.enum(['playwright', 'cypress']).default('playwright'), executionMode: z.enum(['full', 'frontend']).default('full'), requirementRevisionId: z.string().optional(), coverageScope: z.object({ frontend: scope.optional(), backend: scope.optional() }).strict(), repeatRuns: z.literal(2).default(2) }).strict();
export const requirementsRequest = z.object({ criteria: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), description: z.string().min(1).max(2000), expectedOutcome: z.string().min(1).max(4000), references: z.array(z.string().max(1000)).min(1).max(10) }).strict()).min(1).max(100) }).strict();
export const bindingRequest = z.object({ criterionId: z.string(), testFile: relativePath, assertionId: z.string(), expectedOutcome: z.string().min(1).max(4000) }).strict();
export const improvementRequest = z.object({ assessmentId: z.string(), filePath: relativePath, gapIds: z.array(z.string()).min(1).max(20), expectedTestHash: z.string(), instruction: z.string().max(2000).default(''), autoApply: z.boolean().default(false) }).strict();
export const parseRequest = (schema, value) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ServiceError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
    return parsed.data;
};
