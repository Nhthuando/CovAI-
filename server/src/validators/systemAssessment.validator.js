import { z } from 'zod';
import { ServiceError } from '../utils/serviceError.js';

const relativePath = z.string().min(1).max(512).refine(value => !value.includes('\\') && !value.split('/').includes('..') && !/^(?:\/|[a-z]:|https?:)/i.test(value), 'Repository-relative path required');
const scope = z.object({ root: relativePath, sourceDirectory: relativePath }).strict();
export const automaticAssessmentRequest = z.object({ autoDiscover: z.literal(true), runner: z.enum(['playwright', 'cypress']).default('playwright'), executionMode: z.enum(['full', 'frontend']).default('full'), model: z.string().optional() }).strict();
export const assessmentRequest = z.object({ testFiles: z.array(relativePath).min(1).max(20), excludedTests: z.array(z.object({filePath:relativePath,reason:z.string()}).strict()).optional(), runner: z.enum(['playwright', 'cypress']).default('playwright'), executionMode: z.enum(['full', 'frontend']).default('full'), requirementRevisionId: z.string().optional(), reviewMode: z.enum(['legacy', 'scenario']).default('legacy'), scenarioIds: z.array(z.string().min(1)).max(100).default([]), coverageScope: z.object({ frontend: scope.optional(), backend: scope.optional() }).strict(), repeatRuns: z.literal(2).default(2), headed: z.boolean().optional() }).strict();
const briefText = z.string().trim().max(4000);
export const requirementsRequest = z.object({
    brief: z.object({ purpose: briefText, actors: z.array(briefText).max(30), flows: z.array(briefText).max(100), preconditions: z.array(briefText).max(50), dataConstraints: z.array(briefText).max(50) }).strict().optional(),
    criteria: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), description: z.string().min(1).max(2000), expectedOutcome: z.string().min(1).max(4000), references: z.array(z.string().trim().min(1).max(1000)).min(1).max(10) }).strict()).min(1).max(100)
}).strict();
export const bindingRequest = z.object({ criterionId: z.string(), testFile: relativePath, assertionId: z.string(), expectedOutcome: z.string().min(1).max(4000) }).strict();
const scenarioDetails = { title: z.string().trim().min(1).max(300), flow: z.array(z.string().trim().min(1).max(2000)).max(50), inputs: z.array(z.string().trim().min(1).max(2000)).max(50), expected: z.array(z.string().trim().min(1).max(2000)).max(50), criterionIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)).max(100) };
export const scenarioDraftRequest = z.object(scenarioDetails).strict();
export const scenarioUpdateRequest = z.object({ ...scenarioDetails, expectedScenarioHash: z.string().length(64) }).strict();
export const scenarioExpectedConfirmationRequest = z.object({ expectedScenarioHash: z.string().length(64) }).strict();
export const scenarioReviewRequest = z.object({ expectedScenarioHash: z.string().length(64), revisionId: z.string().min(1), expectedRequirementHash: z.string().length(64), assertionIds: z.array(z.string().min(1)).min(1).max(100) }).strict();
export const proposalReviewRequest = z.object({ expectedCandidateTestHash: z.string().length(64), expectedRequirementHash: z.string().length(64), scenarios: z.array(z.object({ ...scenarioDetails, assertionIds: z.array(z.string().min(1)).min(1).max(50) }).strict()).min(1).max(50) }).strict();
export const improvementRequest = z.object({ assessmentId: z.string(), model: z.string().optional(), filePath: relativePath, gapIds: z.array(z.string()).min(1).max(20), expectedTestHash: z.string(), instruction: z.string().max(2000).default(''), autoApply: z.boolean().default(false) }).strict();
export const parseRequest = (schema, value) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ServiceError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
    return parsed.data;
};
