import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { describe, it, expect } from '@jest/globals';
import { createRequirementRevision, confirmRequirementRevision, createAssertionBinding, approveAssertionBinding } from '../services/systemRequirement.service.js';
import { syncSystemScenarioCatalog, updateScenarioDraft, reviewScenario, evaluateRunReadiness } from '../services/systemScenarioCatalog.service.js';
import { analyzeSystemTestFile, digest } from '../services/systemTestStaticAnalysis.service.js';
import { createSystemEventPublisher, replaySystemEvents } from '../services/systemLiveEvent.service.js';
import { persistRunArtifacts, readOwnedRunArtifact } from '../services/systemRunArtifact.service.js';
import { renderSystemTestPdf } from '../services/systemTestPdf.service.js';
import { reviewSystemProposal, registerAppliedProposalReview } from '../services/systemProposalReview.service.js';

const disposableUrl = process.env.COVAI_DISPOSABLE_DATABASE_URL;
const isolated = disposableUrl && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/covai_workflow_test$/.test(disposableUrl);

describe('System Test disposable database workflow', () => {
    (isolated ? it : it.skip)('stores a confirmed brief, reviewed imported scenario and replayable run event', async () => {
        const pool = new Pool({ connectionString: disposableUrl, max: 2 });
        const client = new PrismaClient({ adapter: new PrismaPg(pool) });
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-workflow-db-'));
        let user, project;
        try {
            fs.mkdirSync(path.join(rootDir, 'tests'));
            const filePath = 'tests/login.spec.js';
            const content = "import {test,expect} from '@playwright/test'; test('login',async({page})=>{await expect(page.getByText('Welcome')).toBeVisible();});";
            fs.writeFileSync(path.join(rootDir, filePath), content);
            user = await client.user.create({ data: { email: `workflow-${Date.now()}@example.test` } });
            project = await client.project.create({ data: { ownerId: user.id, name: 'Disposable workflow fixture' } });
            const snapshot = await client.projectSnapshot.create({ data: { projectId: project.id, source: 'ZIP', storagePath: rootDir, rootDir } });
            const revision = await createRequirementRevision({ client, snapshotId: snapshot.id, content: { brief: { purpose: 'Verify login', actors: ['Visitor'], flows: ['Open login'], preconditions: [], dataConstraints: [] }, criteria: [{ id: 'LOGIN', description: 'Login succeeds', expectedOutcome: 'Welcome appears', references: ['Manual brief'] }] } });
            await confirmRequirementRevision({ client, snapshotId: snapshot.id, revisionId: revision.id, contentHash: revision.contentHash, userId: user.id });
            const catalog = await syncSystemScenarioCatalog({ client, snapshotId: snapshot.id, rootDir });
            const imported = catalog.scenarios[0];
            const draft = await updateScenarioDraft({ client, snapshotId: snapshot.id, scenarioId: imported.id, input: { expectedScenarioHash: imported.scenarioHash, title: 'login', flow: ['Open login'], inputs: ['Valid account'], expected: ['Welcome appears'], criterionIds: ['LOGIN'] } });
            const analysis = analyzeSystemTestFile({ content, filePath });
            const binding = await createAssertionBinding({ client, snapshotId: snapshot.id, rootDir, revisionId: revision.id, input: { criterionId: 'LOGIN', testFile: filePath, assertionId: analysis.assertionSites[0].id, expectedOutcome: 'Welcome appears' } });
            await approveAssertionBinding({ client, snapshotId: snapshot.id, rootDir, bindingId: binding.id, testHash: digest(content), bindingHash: digest(binding.bindingJson), userId: user.id });
            await reviewScenario({ client, snapshotId: snapshot.id, rootDir, scenarioId: draft.id, expectedScenarioHash: draft.scenarioHash, revisionId: revision.id, expectedRequirementHash: revision.contentHash, assertionIds: [binding.assertionId], userId: user.id });
            expect((await evaluateRunReadiness({ client, snapshotId: snapshot.id, rootDir, revisionId: revision.id, testFiles: [filePath] })).ready).toBe(true);
            const assessment = await client.systemTestAssessment.create({ data: { snapshotId: snapshot.id, jobId: `fixture-${Date.now()}`, requirementRevisionId: revision.id, sourceHash: 'source', testHash: digest(content), scopeHash: 'scope', runner: 'playwright', executionMode: 'frontend', reportJson: {}, status: 'RUNNING' } });
            const publish = await createSystemEventPublisher({ client, assessmentId: assessment.id, snapshotId: snapshot.id, userId: user.id, io: null });
            await publish({ runIndex: 1, scenarioKey: imported.scenarioKey, type: 'SCENARIO_STARTED', payload: { title: 'login' } });
            expect((await replaySystemEvents({ client, assessmentId: assessment.id, after: 0 })).map(event => event.sequence)).toEqual([1]);
            const relativePath = '.covai-system-test/evidence/checkpoint.png';
            fs.mkdirSync(path.dirname(path.join(rootDir, relativePath)), { recursive: true });
            fs.writeFileSync(path.join(rootDir, relativePath), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
            const artifacts = await persistRunArtifacts({ client, assessmentId: assessment.id, rootDir, catalog: [imported], artifacts: [{ filePath, title: 'login', kind: 'SCREENSHOT', relativePath }] });
            expect(artifacts).toHaveLength(1);
            expect(readOwnedRunArtifact({ rootDir, artifact: artifacts[0] }).bytes.length).toBe(9);
            const completed = await client.systemTestAssessment.update({ where: { id: assessment.id }, data: { status: 'COMPLETED', reportJson: { runs: [], requirements: { total: 1, verified: 1, designed: 1, criteria: [] }, coverage: { tiers: {} }, gaps: [] } } });
            const pdf = await renderSystemTestPdf({ assessment: completed, artifacts });
            expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
            const candidate = `${content}\ntest('logout',async({page})=>{await expect(page.getByText('Signed out')).toBeVisible();});`;
            const proposal = await client.systemTestProposal.create({ data: { snapshotId: snapshot.id, assessmentId: assessment.id, jobId: `proposal-${Date.now()}`, filePath, baseTestHash: digest(content), candidateTestHash: digest(candidate), proposedContent: candidate, state: 'VERIFIED_IMPROVEMENT', verificationJson: { accepted: true } } });
            const logoutAssertion = analyzeSystemTestFile({ content: candidate, filePath }).assertionSites.at(-1);
            const reviewedProposal = await reviewSystemProposal({ client, snapshotId: snapshot.id, rootDir, proposalId: proposal.id, userId: user.id, input: { expectedCandidateTestHash: digest(candidate), expectedRequirementHash: revision.contentHash, scenarios: [{ title: 'logout', flow: ['Click logout'], inputs: ['Authenticated account'], expected: ['Welcome appears'], criterionIds: ['LOGIN'], assertionIds: [logoutAssertion.id] }] } });
            fs.writeFileSync(path.join(rootDir, filePath), candidate);
            await registerAppliedProposalReview({ client, snapshotId: snapshot.id, rootDir, proposal: reviewedProposal });
            const reviewedLogout = await client.systemScenario.findFirst({ where: { snapshotId: snapshot.id, title: 'logout' } });
            expect(reviewedLogout).toMatchObject({ reviewState: 'REVIEWED', expectedJson: ['Welcome appears'], criterionIds: ['LOGIN'] });
            expect(await client.systemAssertionBinding.count({ where: { revisionId: revision.id, assertionId: logoutAssertion.id, status: 'APPROVED' } })).toBe(1);
        } finally {
            if (project) await client.project.delete({ where: { id: project.id } });
            if (user) await client.user.delete({ where: { id: user.id } });
            await client.$disconnect();
            await pool.end();
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    }, 30000);
});
