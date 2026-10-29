import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { scanSystemTestFiles } from '../utils/testFileParser.js';
import { containedPath } from './fullSystemConfig.service.js';
import { analyzeSystemTestFile, digest } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const scenarioIdentity = (filePath, title, occurrence) => digest(`${filePath.replaceAll('\\', '/')}\0${title}\0${occurrence}`);
const reviewedContent = scenario => ({ title: scenario.title, flow: scenario.flowJson, input: scenario.inputJson, expected: scenario.expectedJson, criterionIds: scenario.criterionIds, testHash: scenario.testHash, assertionHashes: scenario.assertionHashes, requirementRevisionId: scenario.requirementRevisionId });
export const scenarioReviewHash = scenario => digest(reviewedContent(scenario));

const readTest = (rootDir, filePath) => {
    if (!/\.(spec|test)\.[cm]?[jt]s$/.test(filePath)) throw new ServiceError('This Playwright adapter supports JS/TS spec files without JSX syntax', 422);
    const absolute = containedPath(rootDir, filePath);
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > 256 * 1024) throw new ServiceError('Test file must be at most 256 KiB', 422);
    return fs.readFileSync(absolute, 'utf8');
};

const assertionOutcome = code => {
    const quoted = code.match(/getBy(?:Text|TestId|Label|Placeholder)\(\s*(['"`])([^'"`]+)\1/)?.[2]
        || code.match(/getByRole\([^)]*name\s*:\s*(['"`])([^'"`]+)\1/)?.[2];
    const subject = quoted ? `“${quoted}”` : 'The asserted value';
    const matcher = code.match(/\.(toBeVisible|toBeHidden|toBeEnabled|toBeDisabled|toBeChecked|toHaveText|toContainText|toHaveClass|toHaveValue|toBe|toEqual)\((.*?)\)\s*$/s);
    if (!matcher) return code;
    const value = matcher[2]?.trim();
    const descriptions = { toBeVisible: 'is visible', toBeHidden: 'is hidden', toBeEnabled: 'is enabled', toBeDisabled: 'is disabled', toBeChecked: 'is checked', toHaveText: `has text ${value}`, toContainText: `contains text ${value}`, toHaveClass: `has class ${value}`, toHaveValue: `has value ${value}`, toBe: `equals ${value}`, toEqual: `equals ${value}` };
    return `${subject} ${descriptions[matcher[1]]}`;
};

const draftFromTest = (content, site, analysis) => {
    const body = content.slice(site.start, site.end);
    const actions = [...body.matchAll(/await\s+((?!expect\b)[^;\n]+)(?:;|\n|$)/g)]
        .map(match => match[1].trim()).filter(Boolean).slice(0, 12);
    const assertions = analysis.assertionSites
        .filter(assertion => assertion.scenarioLine === site.line && assertion.supported)
        .map(assertion => assertionOutcome(assertion.code.trim())).slice(0, 12);
    return { flowJson: actions, inputJson: actions.filter(action => /\.(?:fill|type|selectOption|check|press)\s*\(/.test(action)), expectedJson: assertions };
};

export const syncSystemScenarioCatalog = async ({ client, snapshotId, rootDir }) => {
    const files = scanSystemTestFiles(rootDir).playwrightFiles.map(file => file.filePath);
    const seen = new Set(), unsupportedFeatures = [];
    for (const filePath of files) {
        let content, analysis;
        try {
            content = readTest(rootDir, filePath);
            analysis = analyzeSystemTestFile({ content, filePath });
        } catch (error) {
            unsupportedFeatures.push({ filePath, reason: error.statusCode ? error.message : 'Test file could not be analyzed' });
            continue;
        }
        unsupportedFeatures.push(...analysis.unsupportedFeatures.map(reason => ({ filePath, reason })));
        const occurrences = new Map();
        for (const site of analysis.scenarioSites) {
            const occurrence = occurrences.get(site.title) || 0;
            occurrences.set(site.title, occurrence + 1);
            const scenarioKey = scenarioIdentity(filePath, site.title, occurrence);
            seen.add(scenarioKey);
            const assertions = analysis.assertionSites.filter(assertion => assertion.scenarioLine === site.line).map(assertion => assertion.hash).sort();
            const testHash = digest(content);
            const existing = await client.systemScenario.findUnique({ where: { snapshotId_scenarioKey: { snapshotId, scenarioKey } } });
            if (!existing) {
                const draft = { snapshotId, scenarioKey, source: 'IMPORTED', filePath, title: site.title, ...draftFromTest(content, site, analysis), criterionIds: [], reviewState: 'DRAFT', scenarioHash: '', testHash, assertionHashes: assertions };
                draft.scenarioHash = scenarioReviewHash(draft);
                await client.systemScenario.create({ data: draft });
            } else if (existing.testHash !== testHash || JSON.stringify(existing.assertionHashes) !== JSON.stringify(assertions)) {
                const extracted = draftFromTest(content, site, analysis);
                const changed = { ...existing, testHash, assertionHashes: assertions,
                    flowJson: existing.flowJson?.length ? existing.flowJson : extracted.flowJson,
                    inputJson: existing.inputJson?.length ? existing.inputJson : extracted.inputJson,
                    expectedJson: existing.expectedJson?.length ? existing.expectedJson : extracted.expectedJson };
                await client.systemScenario.update({ where: { id: existing.id }, data: { testHash, assertionHashes: assertions, flowJson: changed.flowJson, inputJson: changed.inputJson, expectedJson: changed.expectedJson, scenarioHash: scenarioReviewHash(changed), reviewState: 'STALE', reviewedByUserId: null, reviewedAt: null } });
            }
        }
    }
    const all = await client.systemScenario.findMany({ where: { snapshotId }, orderBy: [{ filePath: 'asc' }, { title: 'asc' }] });
    for (const scenario of all) if (scenario.filePath && !seen.has(scenario.scenarioKey)) await client.systemScenario.delete({ where: { id: scenario.id } });
    return { scenarios: await client.systemScenario.findMany({ where: { snapshotId }, orderBy: [{ filePath: 'asc' }, { title: 'asc' }] }), discoveryStatus: files.length ? 'DISCOVERED' : 'NO_TESTS', unsupportedFeatures };
};

export const createManualScenario = async ({ client, snapshotId, input }) => {
    const scenarioKey = digest(`manual:${snapshotId}:${crypto.randomUUID()}`);
    const draft = { snapshotId, scenarioKey, source: 'MANUAL', filePath: null, title: input.title, flowJson: input.flow, inputJson: input.inputs, expectedJson: input.expected, criterionIds: input.criterionIds, reviewState: 'DRAFT', scenarioHash: '', testHash: null, assertionHashes: [] };
    draft.scenarioHash = scenarioReviewHash(draft);
    return client.systemScenario.create({ data: draft });
};

export const materializeManualScenario = async ({ client, snapshotId, rootDir, scenarioId }) => {
    const scenario = await client.systemScenario.findFirst({ where: { id: scenarioId, snapshotId, source: 'MANUAL', filePath: null } });
    if (!scenario) throw new ServiceError('Manual draft not found or already materialized', 404);
    const filePath = `tests/covai-${scenario.id.replace(/[^A-Za-z0-9_-]/g, '')}.spec.js`;
    const absolute = containedPath(rootDir, filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const title = JSON.stringify(scenario.title);
    const content = `import { test, expect } from '@playwright/test';\n\ntest(${title}, async ({ page }) => {\n  await page.goto('/');\n  throw new Error('Implement the reviewed Flow, Input and Expected with a real application assertion.');\n});\n`;
    try { fs.writeFileSync(absolute, content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') throw new ServiceError('Scenario test file already exists', 409); throw error; }
    const scenarioKey = scenarioIdentity(filePath, scenario.title, 0);
    const changed = { ...scenario, scenarioKey, filePath, testHash: digest(content), assertionHashes: [] };
    return client.systemScenario.update({ where: { id: scenario.id }, data: { scenarioKey, filePath, testHash: changed.testHash, scenarioHash: scenarioReviewHash(changed), reviewState: 'DRAFT' } });
};

export const updateScenarioDraft = async ({ client, snapshotId, scenarioId, input }) => {
    const current = await client.systemScenario.findFirst({ where: { id: scenarioId, snapshotId } });
    if (!current) throw new ServiceError('Scenario not found', 404);
    if (current.scenarioHash !== input.expectedScenarioHash) throw new ServiceError('Scenario changed; reload before editing', 409);
    if (current.filePath && current.title !== input.title) throw new ServiceError('Rename the test title in its source file, then sync the catalog', 409);
    const next = { ...current, title: input.title, flowJson: input.flow, inputJson: input.inputs, expectedJson: input.expected, criterionIds: input.criterionIds };
    return client.systemScenario.update({ where: { id: current.id }, data: { title: next.title, flowJson: next.flowJson, inputJson: next.inputJson, expectedJson: next.expectedJson, criterionIds: next.criterionIds, scenarioHash: scenarioReviewHash(next), reviewState: 'DRAFT', reviewedByUserId: null, reviewedAt: null } });
};

export const confirmScenarioExpected = async ({ client, snapshotId, rootDir, scenarioId, expectedScenarioHash, userId }) => {
    const scenario = await client.systemScenario.findFirst({ where: { id: scenarioId, snapshotId } });
    if (!scenario) throw new ServiceError('Scenario not found', 404);
    if (scenario.scenarioHash !== expectedScenarioHash) throw new ServiceError('Scenario changed; reload before confirming', 409);
    if (!scenario.expectedJson?.some(nonempty)) throw new ServiceError('Add an Expected outcome before confirming', 422);
    if (scenario.filePath && digest(readTest(rootDir, scenario.filePath)) !== scenario.testHash) throw new ServiceError('Test file changed; sync before confirming', 409);
    return client.systemScenario.update({ where: { id: scenario.id }, data: { reviewState: 'EXPECTED_CONFIRMED', reviewedByUserId: userId, reviewedAt: new Date() } });
};

export const reviewScenario = async ({ client, snapshotId, rootDir, scenarioId, expectedScenarioHash, revisionId, expectedRequirementHash, assertionIds, userId }) => {
    const scenario = await client.systemScenario.findFirst({ where: { id: scenarioId, snapshotId } });
    if (!scenario) throw new ServiceError('Scenario not found', 404);
    if (scenario.scenarioHash !== expectedScenarioHash) throw new ServiceError('Scenario changed; review again', 409);
    if (!scenario.filePath || !scenario.testHash || digest(readTest(rootDir, scenario.filePath)) !== scenario.testHash) throw new ServiceError('Runnable test changed or is missing', 409);
    if (![scenario.flowJson, scenario.inputJson, scenario.expectedJson].every(values => Array.isArray(values) && values.length && values.every(nonempty))) throw new ServiceError('Flow, Input and Expected are required', 422);
    const revision = await client.systemRequirementRevision.findFirst({ where: { id: revisionId, snapshotId, status: 'CONFIRMED' } });
    if (!revision || revision.contentHash !== expectedRequirementHash) throw new ServiceError('Confirmed requirements changed', 409);
    if (!scenario.criterionIds.length || !scenario.criterionIds.every(id => revision.contentJson.criteria.some(criterion => criterion.id === id))) throw new ServiceError('Link scenario to confirmed criteria', 422);
    if (!scenario.criterionIds.every(id => {
        const outcome = revision.contentJson.criteria.find(criterion => criterion.id === id)?.expectedOutcome;
        return nonempty(outcome) && scenario.expectedJson.some(expected => expected.trim().toLocaleLowerCase() === outcome.trim().toLocaleLowerCase());
    })) throw new ServiceError('Scenario Expected must include each linked confirmed outcome', 422);
    const bindings = await client.systemAssertionBinding.findMany({ where: { revisionId, testFile: scenario.filePath, testHash: scenario.testHash, status: 'APPROVED', assertionId: { in: assertionIds } } });
    const analysis = analyzeSystemTestFile({ content: readTest(rootDir, scenario.filePath), filePath: scenario.filePath });
    const site = analysis.scenarioSites.filter(candidate => candidate.title === scenario.title).find((candidate, index) => scenarioIdentity(scenario.filePath, candidate.title, index) === scenario.scenarioKey);
    if (!assertionIds.length || bindings.length !== assertionIds.length || !scenario.criterionIds.every(id => bindings.some(binding => binding.criterionId === id)) || !site || !bindings.every(binding => binding.scenarioId === site.id && scenario.assertionHashes.includes(binding.bindingJson.assertionHash))) throw new ServiceError('Approved assertions for each criterion are required', 422);
    const next = { ...scenario, requirementRevisionId: revisionId };
    return client.systemScenario.update({ where: { id: scenario.id }, data: { requirementRevisionId: revisionId, scenarioHash: scenarioReviewHash(next), reviewState: 'REVIEWED', reviewedByUserId: userId, reviewedAt: new Date() } });
};

export const evaluateRunReadiness = async ({ client, snapshotId, rootDir, revisionId, testFiles, reviewMode = 'legacy', scenarioIds = [] }) => {
    const blockers = [];
    if (reviewMode === 'scenario') {
        if (!scenarioIds.length) blockers.push({ code: 'NO_SELECTION', message: 'Select at least one scenario to run' });
        const all = await client.systemScenario.findMany({ where: { snapshotId, filePath: { in: testFiles } } });
        const selected = all.filter(scenario => scenarioIds.includes(scenario.id));
        if (selected.length !== scenarioIds.length || selected.some(scenario => !scenario.filePath)) blockers.push({ code: 'INVALID_SELECTION', message: 'Selected scenarios must belong to this snapshot and have test files' });
        const selectedFiles = [...new Set(selected.map(scenario => scenario.filePath))];
        if (selectedFiles.length !== testFiles.length || selectedFiles.some(file => !testFiles.includes(file))) blockers.push({ code: 'FILE_SELECTION_MISMATCH', message: 'Selected files must match selected scenarios' });
        for (const filePath of testFiles) {
            try {
                const content = readTest(rootDir, filePath), hash = digest(content);
                const analysis = analyzeSystemTestFile({ content, filePath });
                if (analysis.unsupportedFeatures.length) blockers.push({ filePath, code: 'UNSUPPORTED_ASSERTION_ANALYSIS', message: `Test analysis is unsupported in ${filePath}` });
                const fileRows = all.filter(scenario => scenario.filePath === filePath);
                for (const scenario of fileRows.filter(item => scenarioIds.includes(item.id))) {
                    if (scenario.testHash !== hash || scenario.reviewState === 'STALE') blockers.push({ scenarioKey: scenario.scenarioKey, code: 'TEST_CHANGED', message: `Sync ${filePath} before running` });
                    if (!['EXPECTED_CONFIRMED', 'REVIEWED'].includes(scenario.reviewState)) blockers.push({ scenarioKey: scenario.scenarioKey, code: 'EXPECTED_UNCONFIRMED', message: `Confirm the expected outcome for ${scenario.title}` });
                    const matching = analysis.scenarioSites.filter(site => site.title === scenario.title);
                    if (matching.length !== 1 || !analysis.assertionSites.some(site => site.scenarioLine === matching[0]?.line && site.supported)) blockers.push({ scenarioKey: scenario.scenarioKey, code: 'ASSERTION_REQUIRED', message: `A supported assertion is required for ${scenario.title}` });
                    if (fileRows.filter(item => item.title === scenario.title).length !== 1) blockers.push({ scenarioKey: scenario.scenarioKey, code: 'AMBIGUOUS_SCENARIO', message: `Use unique scenario titles in ${filePath}` });
                }
            } catch { blockers.push({ filePath, code: 'TEST_UNAVAILABLE', message: `Test file ${filePath} is unavailable` }); }
        }
        for (const title of new Set(selected.map(scenario => scenario.title))) {
            if (all.some(scenario => scenario.title === title && !scenarioIds.includes(scenario.id))) blockers.push({ code: 'AMBIGUOUS_SELECTION', message: `Select every scenario named ${title}, or give them distinct titles` });
        }
        return { ready: blockers.length === 0, blockers };
    }
    const revision = await client.systemRequirementRevision.findFirst({ where: { id: revisionId || '', snapshotId, status: 'CONFIRMED' } });
    if (!revision) blockers.push({ code: 'REQUIREMENTS_UNCONFIRMED', message: 'Confirm business requirements and expected outcomes before running' });
    const scenarios = await client.systemScenario.findMany({ where: { snapshotId, filePath: { in: testFiles } } });
    for (const filePath of testFiles) {
        const fileScenarios = scenarios.filter(scenario => scenario.filePath === filePath);
        if (!fileScenarios.length) blockers.push({ filePath, code: 'NO_REVIEWABLE_SCENARIO', message: 'No supported scenario was discovered in this file' });
        let hash;
        try {
            const content = readTest(rootDir, filePath);
            hash = digest(content);
            const analysis = analyzeSystemTestFile({ content, filePath });
            if (analysis.unsupportedFeatures.length) blockers.push({ filePath, code: 'UNSUPPORTED_ASSERTION_ANALYSIS', message: `Review adapter cannot prove assertions in ${filePath}: ${analysis.unsupportedFeatures[0]}` });
            const titles = analysis.scenarioSites.map(site => site.title);
            if (new Set(titles).size !== titles.length) blockers.push({ filePath, code: 'AMBIGUOUS_SCENARIO', message: `Use distinct scenario titles in ${filePath} for individual evidence attribution` });
        } catch { blockers.push({ filePath, code: 'TEST_UNAVAILABLE', message: 'Test file is unavailable' }); continue; }
        for (const scenario of fileScenarios) {
            if (scenario.testHash !== hash) blockers.push({ scenarioKey: scenario.scenarioKey, code: 'TEST_CHANGED', message: 'Test file changed after review' });
            else if (scenario.reviewState !== 'REVIEWED' || scenario.requirementRevisionId !== revision?.id) blockers.push({ scenarioKey: scenario.scenarioKey, code: 'REVIEW_REQUIRED', message: 'Review Flow, Input, Expected and assertion bindings' });
        }
    }
    return { ready: blockers.length === 0, blockers };
};
