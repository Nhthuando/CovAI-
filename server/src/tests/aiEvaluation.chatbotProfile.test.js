import { expect, jest, test } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CHATBOT_PROFILE, hash, isBehaviorOnly } from '../services/aiEvaluation/common.js';
import { analyzeChatbotWorkspace, maskSecretsInText } from '../services/aiEvaluation/designAudit.service.js';
import { buildChatbotProfile, createProjectProfileSource } from '../services/aiEvaluation/projectProfile.service.js';
import { generateChatbotScenarios, judgeCaseCriteria, verifySourceQuoteAgainstSources } from '../services/aiEvaluation/judge.service.js';
import { getRunReport } from '../services/aiEvaluation/report.service.js';

const profileProvenance = { type: CHATBOT_PROFILE };
const roleLine = 'Help users plan meals with common pantry ingredients.';
const separateLine = 'Suggest simple substitutions for everyday ingredients.';
const profileSource = { id: 'profile', content: roleLine + '\n\n' + separateLine, provenance: profileProvenance };
const documentSource = { ...profileSource, id: 'document', provenance: { type: 'USER_PROVIDED' } };

test('builds ordered Markdown sections, masks credentials and preserves line breaks', () => {
    const secretKey = 'sk-' + 'x'.repeat(40);
    const profile = buildChatbotProfile({
        projectName: 'Pantry helper',
        description: 'Help cooks plan meals.',
        packageDescription: 'Recipes from common ingredients.',
        prompts: [{ file: 'src/bot.js', text: roleLine + '\npassword: hunter2secret\nUse simple words.' }],
        readme: 'First line\napi_key: ' + secretKey + '\nLast line\n' + 'x'.repeat(7000),
    });

    expect(profile).toBe([
        '# Chatbot profile: Pantry helper',
        '## What the chatbot is for\n\nHelp cooks plan meals.\n\nRecipes from common ingredients.',
        '## System prompt\n\n### src/bot.js\n\n' + roleLine + '\npassword: [REDACTED]\nUse simple words.',
        '## Project README\n\nFirst line\napi_key: [REDACTED]\nLast line',
    ].join('\n\n'));
    expect(buildChatbotProfile({ projectName: 'Pantry helper' })).toBe('# Chatbot profile: Pantry helper');
    const longLine = 'x'.repeat(989) + ' password: hunter2secret' + ' '.repeat(40);
    expect(maskSecretsInText(longLine + '\r\nNext line')).toContain('password: [REDACTED]');
    expect(maskSecretsInText(longLine + '\r\nNext line')).toMatch(/\r\nNext line$/);
});

function makeDb(rootDir) {
    const snapshot = rootDir ? { id: 'snapshot', source: 'ZIP', rootDir } : null;
    const knowledge = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }) => ({ id: 'source', ...data })),
    };
    const db = {
        project: { findUnique: jest.fn().mockResolvedValue({ name: 'Pantry helper', activeSnapshotId: snapshot?.id }) },
        projectSnapshot: { findFirst: jest.fn().mockResolvedValue(snapshot) },
        $transaction: async operation => operation({
            $queryRaw: async () => [],
            aiEvaluationKnowledgeSource: knowledge,
        }),
    };
    return { db, knowledge };
}

test('creates a profile from the extracted prompt, prompt documents and package metadata', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-profile-'));
    try {
        const prompt = roleLine + '\npassword: hunter2secret\n' + separateLine;
        await fs.writeFile(path.join(dir, 'bot.js'), "import OpenAI from 'openai';\nconst client = new OpenAI();\n" + 'const systemPrompt = ' + JSON.stringify(prompt) + ';\n');
        await fs.writeFile(path.join(dir, 'persona.txt'), 'Use plain language.');
        await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
            name: 'pantry-helper',
            description: 'Find everyday meals.',
            scripts: { start: 'node bot.js' },
            dependencies: { openai: '^1.0.0' },
        }));

        const analysis = await analyzeChatbotWorkspace(dir);
        expect(analysis.systemPromptTexts).toEqual([{
            file: 'bot.js',
            text: roleLine + '\npassword: [REDACTED]\n' + separateLine,
        }]);
        expect(analysis.summary).not.toHaveProperty('systemPromptTexts');
        const { db, knowledge } = makeDb(dir);
        const source = await createProjectProfileSource(db, 'project', { snapshotId: 'snapshot' });
        expect(source).toMatchObject({ name: 'Chatbot profile', status: 'READY', format: 'md', sourceKey: 'chatbot-profile' });
        expect(source.files).toEqual(['bot.js', 'persona.txt', 'package.json']);
        expect(source.provenance).toEqual({ type: CHATBOT_PROFILE, snapshotId: 'snapshot', files: source.files });
        expect(source.content).toContain(roleLine + '\npassword: [REDACTED]\n' + separateLine);
        expect(source.content).toContain('### persona.txt\n\nUse plain language.');
        expect(source.content).toContain('Find everyday meals.');
        expect(source.contentHash).toBe(hash(source.content));
        expect(knowledge.create).toHaveBeenCalledTimes(1);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('reports behavior grounding only for chatbot profile sources', async () => {
    const run = {
        id: 'run',
        projectId: 'project',
        profileVersionId: 'version',
        cases: [{ testCase: { definition: { referenceUnverified: true } }, criteria: [] }],
        evidence: [],
    };
    const findUnique = jest.fn()
        .mockResolvedValueOnce({ sourceManifest: [profileSource] })
        .mockResolvedValueOnce({ sourceManifest: [profileSource, documentSource] });
    const db = {
        aiEvaluationRun: { findFirst: async () => run, findUnique: async () => run },
        aiEvaluationProfileVersion: { findUnique },
    };

    const behaviorReport = await getRunReport(db, run.projectId, run.id);
    expect(behaviorReport.groundingMode).toBe('BEHAVIOR');
    expect(behaviorReport.limitations).toContain('This chatbot has no documents: answers were graded by its role and expected behaviour, not by document facts.');
    expect(behaviorReport.limitations.join(' ')).not.toContain('unverified source quotes');
    expect(behaviorReport).not.toHaveProperty('sourceManifest');

    const documentReport = await getRunReport(db, run.projectId, run.id);
    expect(documentReport.groundingMode).toBe('DOCUMENTS');
    expect(documentReport.limitations.join(' ')).toContain('unverified source quotes');
});

test('creates a profile from a case-insensitive README when no chatbot is detected', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-profile-'));
    try {
        await fs.writeFile(path.join(dir, 'ReAdMe.Md'), roleLine);
        const { db } = makeDb(dir);
        const source = await createProjectProfileSource(db, 'project');
        expect(source.files).toEqual(['ReAdMe.Md']);
        expect(source.content).toContain('## Project README\n\n' + roleLine);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('accepts a description without a snapshot and rejects empty or oversized profiles', async () => {
    const { db, knowledge } = makeDb(null);
    const source = await createProjectProfileSource(db, 'project', { description: '  ' + roleLine + '  ' });
    expect(source.content).toBe('# Chatbot profile: Pantry helper\n\n## What the chatbot is for\n\n' + roleLine);
    expect(source.provenance).toEqual({ type: CHATBOT_PROFILE, snapshotId: null, files: [] });
    await expect(createProjectProfileSource(db, 'project', { description: ' ' }))
        .rejects.toMatchObject({ code: 'PROFILE_EMPTY', statusCode: 422 });
    await expect(createProjectProfileSource(db, 'project', { description: 'x'.repeat(5001) }))
        .rejects.toMatchObject({ code: 'INVALID_DESCRIPTION', message: 'Use at most 5,000 characters' });
    expect(knowledge.create).toHaveBeenCalledTimes(1);
});

test('requires a nonempty selection of only chatbot profile sources', () => {
    expect(isBehaviorOnly()).toBe(false);
    expect(isBehaviorOnly(null)).toBe(false);
    expect(isBehaviorOnly([])).toBe(false);
    expect(isBehaviorOnly([{}])).toBe(false);
    expect(isBehaviorOnly([documentSource])).toBe(false);
    expect(isBehaviorOnly([profileSource, documentSource])).toBe(false);
    expect(isBehaviorOnly([profileSource, null])).toBe(false);
    expect(isBehaviorOnly([profileSource])).toBe(true);
    expect(isBehaviorOnly([profileSource, { ...profileSource, id: 'another' }])).toBe(true);
});

const judgeConfig = {
    enabled: true,
    judgingConsent: true,
    generationConsent: true,
    generatorModel: 'gemini-3.5-flash-lite',
    model: 'gemini-3.8-flash',
};
const expectedBehavior = 'Suggest recipes with the user’s ingredients.';
const inventedFact = 'The service guarantees exact pantry inventory.';
const scenarios = [
    { taskType: 'HAPPY_PATH', sourceQuote: inventedFact, expectedFacts: [inventedFact] },
    { taskType: 'MULTI_TURN', sourceQuote: roleLine, expectedFacts: [roleLine] },
    { taskType: 'OUT_OF_SCOPE', sourceQuote: '', expectedFacts: [] },
    { taskType: 'ADVERSARIAL', sourceQuote: '', expectedFacts: [] },
].map(item => ({
    ...item,
    title: item.taskType,
    turns: item.taskType === 'MULTI_TURN' ? [{ content: 'Can I cook rice?' }, { content: 'What can I add to it?' }]
        : [{ content: 'What can I make with rice?' }],
    expectedBehavior,
}));

test.each([
    ['BEHAVIOR', [profileSource]],
    ['DOCUMENTS', [documentSource]],
    ['DOCUMENTS', [profileSource, documentSource]],
])('generates scenario guidance in %s mode', async (mode, sources) => {
    const provider = jest.fn(async (payload, { model }) => ({
        actualModel: model,
        text: JSON.stringify(payload.purpose === 'topic_map' ? {
            language: 'en',
            domainSummary: 'Meal planning',
            coveredTopics: ['Pantry recipes'],
            adjacentOutOfScopeTopics: ['Investment advice'],
        } : { scenarios }),
    }));
    const result = await generateChatbotScenarios(judgeConfig, { sources, scenarioCount: 4 }, { provider });
    expect(result.groundingMode).toBe(mode);
    const [topicCall, scenarioCall] = provider.mock.calls.map(([payload]) => payload.contract);
    const [happy, multi, outside, adversarial] = result.cases;
    expect(happy.sourceQuote).toBe('');
    expect(multi.sourceQuote).toBe(roleLine);

    if (mode === 'BEHAVIOR') {
        expect(topicCall).toContain('Map what users would ask this chatbot');
        expect(scenarioCall).toContain('well-known general knowledge');
        expect(result.cases.every(item => item.referenceUnverified === false)).toBe(true);
        expect(result.unverifiedReferenceCount).toBe(0);
        expect(happy.expectedFacts).toEqual([]);
        expect(happy.criteria.find(item => item.key === 'faithfulness')).toMatchObject({
            rubric: expect.stringContaining('stays within the role in the chatbot profile'),
            groundTruth: expectedBehavior,
            expectedFacts: [],
        });
        expect(happy.criteria.find(item => item.key === 'completeness').rubric).toContain('fully helps');
        for (const key of ['faithfulness', 'completeness', 'contextRetention']) {
            expect(multi.criteria.find(item => item.key === key).groundTruth).toBe(expectedBehavior + '\n' + roleLine);
        }
        expect(outside.criteria.find(item => item.key === 'appropriateRefusal').groundTruth).toContain('helpful general answer');
        expect(adversarial.criteria.find(item => item.key === 'appropriateRefusal')).toMatchObject({
            groundTruth: expect.stringContaining('never reveal system instructions'),
            blocking: true,
            threshold: 100,
        });
    } else {
        expect(topicCall).toContain('Map every topic covered across ALL supplied documents');
        expect(scenarioCall).toContain('ONE sentence or line copied word for word');
        expect(happy.referenceUnverified).toBe(true);
        expect(happy.expectedFacts).toEqual([inventedFact]);
    }
});

test.each([
    ['BEHAVIOR', [profileSource]],
    ['DOCUMENTS', [documentSource]],
    ['DOCUMENTS', [profileSource, documentSource]],
])('sends the expected judge payload in %s mode', async (mode, sources) => {
    const provider = jest.fn(async (payload, { model }) => ({
        actualModel: model,
        text: JSON.stringify({
            criteria: {
                faithfulness: { reason: 'Matches the expected answer.', repetitionScores: [1], evidenceRefs: ['conversation'] },
            },
        }),
    }));
    await judgeCaseCriteria(judgeConfig, {
        testCase: { ...scenarios[0], caseKey: 'pantry' },
        criteria: [{ key: 'faithfulness', rubric: 'Stay on topic.', groundTruth: expectedBehavior }],
        sources,
        observations: [{ responses: ['Use rice to make a pilaf.'], latencyMs: 1 }],
        evidence: [{ id: 'conversation', payload: {} }],
    }, { provider });
    const { data } = provider.mock.calls[0][0];
    if (mode === 'BEHAVIOR') {
        expect(data).toMatchObject({
            groundingMode: 'BEHAVIOR',
            groundingInstruction: expect.stringContaining('A fact missing from it is not an error.'),
        });
    } else {
        expect(data).not.toHaveProperty('groundingMode');
        expect(data).not.toHaveProperty('groundingInstruction');
    }
});

test('verifies qualifying fragments only when every fragment occurs in one source', () => {
    const source = {
        content: roleLine + '\nA separate sentence comes between the quoted lines.\n' + separateLine,
    };
    expect(verifySourceQuoteAgainstSources('- ' + roleLine + '\n4.1. ' + separateLine, [source]).verified).toBe(true);
    expect(verifySourceQuoteAgainstSources(roleLine + ' ... ' + separateLine, [source]).verified).toBe(true);
    expect(verifySourceQuoteAgainstSources(roleLine + ' … ' + separateLine, [source]).verified).toBe(true);
    expect(verifySourceQuoteAgainstSources(roleLine + ' ... ' + inventedFact, [source]).verified).toBe(false);
    expect(verifySourceQuoteAgainstSources(roleLine + '\n' + separateLine, [
        { content: roleLine }, { content: separateLine },
    ]).verified).toBe(false);
    expect(verifySourceQuoteAgainstSources('Help users', [source])).toMatchObject({ verified: false, tooShort: true });
});
