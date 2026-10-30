import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, jest } from '@jest/globals';
import { reviewSystemProposal } from '../services/systemProposalReview.service.js';
import { analyzeSystemTestFile, digest } from '../services/systemTestStaticAnalysis.service.js';

describe('AI proposal owner review', () => {
    it('pins new scenario Input, Expected and assertion to the exact verified candidate', async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-proposal-review-'));
        try {
            fs.mkdirSync(path.join(rootDir, 'tests'));
            const filePath = 'tests/home.spec.js';
            const before = "import {test,expect} from '@playwright/test'; test('old',async({page})=>{await expect(page.getByText('Old')).toBeVisible();});";
            const candidate = `${before}\ntest('new',async({page})=>{await expect(page.getByText('Welcome')).toBeVisible();});`;
            fs.writeFileSync(path.join(rootDir, filePath), before);
            const assertion = analyzeSystemTestFile({ content: candidate, filePath }).assertionSites.at(-1);
            const proposal = { id: 'proposal', snapshotId: 'snapshot', state: 'VERIFIED_IMPROVEMENT', filePath, baseTestHash: digest(before), candidateTestHash: digest(candidate), proposedContent: candidate, verificationJson: { accepted: true }, assessment: { requirementRevisionId: 'revision' } };
            const client = { systemTestProposal: { findFirst: jest.fn().mockResolvedValue(proposal), update: jest.fn(async ({ data }) => ({ ...proposal, ...data })) }, systemRequirementRevision: { findFirst: jest.fn().mockResolvedValue({ id: 'revision', contentHash: 'requirement-hash', contentJson: { criteria: [{ id: 'WELCOME', expectedOutcome: 'Welcome visible' }] } }) } };
            const valid = { expectedCandidateTestHash: digest(candidate), expectedRequirementHash: 'requirement-hash', scenarios: [{ title: 'new', flow: ['Open page'], inputs: ['Guest'], expected: ['Welcome visible'], criterionIds: ['WELCOME'], assertionIds: [assertion.id] }] };
            const saved = await reviewSystemProposal({ client, snapshotId: 'snapshot', rootDir, proposalId: 'proposal', input: valid, userId: 'owner' });
            expect(saved.verificationJson.review).toMatchObject({ candidateHash: digest(candidate), requirementRevisionId: 'revision', reviewedByUserId: 'owner' });
            await expect(reviewSystemProposal({ client, snapshotId: 'snapshot', rootDir, proposalId: 'proposal', input: { ...valid, scenarios: [{ ...valid.scenarios[0], expected: ['Different'] }] }, userId: 'owner' })).rejects.toMatchObject({ statusCode: 422 });
        } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
    });
});
