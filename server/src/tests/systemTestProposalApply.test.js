import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, jest } from '@jest/globals';
import { createMutationTestClient } from './helpers/mutationClient.js';
await jest.unstable_mockModule('../config/prisma.js', () => ({ default: {} }));
const { applySystemProposal } = await import('../services/systemTestImprovementJob.service.js');
const { snapshotIdentity } = await import('../services/systemAssessmentWorkspace.service.js');
const { digest, preserveTestIntent } = await import('../services/systemTestStaticAnalysis.service.js');
const evidence = filePath => {
    const report=covered=>({sourceHash:'source',scopeHash:'scope',configHash:'config',requirements:{criteria:[]},stability:{passedRuns:2,runs:2},runs:[0,1].map(()=>({testRun:{status:'PASSED',scenarios:[{testFile:filePath,title:'old',status:'passed'},{testFile:filePath,title:'new',status:'passed'}]}})),coverage:{tiers:{frontend:{status:'MEASURED',counters:Object.fromEntries(['lines','branches','functions','statements'].map(metric=>[metric,{covered,total:10,pct:covered*10}]))}}}});
    return {baseline:report(4),candidate:report(5)};
};

describe('Verified proposal application', () => {
    it('saves only a verified exact candidate and records the applying owner', async () => {
        const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-auto-apply-'));
        try {
            fs.mkdirSync(path.join(root,'tests'));
            const filePath='tests/app.spec.js', before="import {test,expect} from '@playwright/test';test('old',async()=>{});", candidate=before+"test('new',async({page})=>{await expect(page.getByText('saved')).toBeVisible();});";
            fs.writeFileSync(path.join(root,filePath),before);
            const proposal={id:'p',state:'PROVIDER_UNAVAILABLE',filePath,baseTestHash:digest(before),candidateTestHash:digest(candidate),proposedContent:candidate,assessment:snapshotIdentity(root),verificationJson:evidence(filePath)};
            const client={...createMutationTestClient({rootDir:root}),systemTestProposal:{findFirst:jest.fn().mockResolvedValue(proposal),update:jest.fn().mockResolvedValue({state:'APPLIED'})}};
            const input={client,rootDir:root,snapshotId:'s',proposalId:'p',expectedCurrentTestHash:digest(before),expectedCandidateTestHash:digest(candidate),userId:'owner',lease:{assertHeld:async()=>{}}};
            await expect(applySystemProposal(input)).rejects.toMatchObject({statusCode:409});
            expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
            proposal.state='NO_MEASURED_IMPROVEMENT';
            await expect(applySystemProposal(input)).rejects.toMatchObject({statusCode:409});
            proposal.state='VERIFIED_IMPROVEMENT';
            const gain=proposal.verificationJson.candidate;
            proposal.verificationJson.candidate=proposal.verificationJson.baseline;
            await expect(applySystemProposal(input)).rejects.toMatchObject({statusCode:409});
            proposal.verificationJson.candidate=gain;
            proposal.state='VERIFIED_IMPROVEMENT';
            await expect(applySystemProposal(input)).resolves.toMatchObject({state:'APPLIED'});
            expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(candidate);
            expect(client.systemTestProposal.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'APPLIED',appliedByUserId:'owner'})}));
        } finally {fs.rmSync(root,{recursive:true,force:true});}
    });
    it('rejects a changed current file and restores original bytes on database failure', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-apply-test-'));
        try {
            fs.mkdirSync(path.join(root, 'tests'));
            const filePath = 'tests/app.spec.js', file = path.join(root, filePath);
            const before = "import {test,expect} from '@playwright/test'; test('old',async({page})=>{await expect(page.getByText('item')).toBeVisible();});";
            const candidate = before + "test('new',async({page})=>{await expect(page.getByText('other')).toBeVisible();});";
            fs.writeFileSync(file, before);
            const identity = snapshotIdentity(root);
            const proposal = { id: 'p', snapshotId: 's', state: 'VERIFIED_IMPROVEMENT', filePath, proposedContent: candidate, baseTestHash: digest(before), candidateTestHash: digest(candidate), assessment: identity, verificationJson:evidence(filePath) };
            const client = {...createMutationTestClient({rootDir:root}), systemTestProposal: { findFirst: jest.fn().mockResolvedValue(proposal), update: jest.fn().mockRejectedValue(new Error('database failure')) } };
            const input = { client, rootDir: root, snapshotId: 's', proposalId: 'p', expectedCurrentTestHash: digest(before), expectedCandidateTestHash: digest(candidate), userId: 'owner', lease: { assertHeld: async () => {} } };
            fs.writeFileSync(file, before + '\n// another edit');
            await expect(applySystemProposal(input)).rejects.toMatchObject({ statusCode: 409 });
            expect(client.systemTestProposal.update).not.toHaveBeenCalled();
            fs.writeFileSync(file, before);
            await expect(applySystemProposal(input)).rejects.toThrow('database failure');
            expect(fs.readFileSync(file, 'utf8')).toBe(before);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('does not allow AI to change fixtures, imports, helpers, or expected outcomes', () => {
        const before = "import {test,expect} from '@playwright/test';const expected='item';test('old',async({page})=>{await expect(page.getByText(expected)).toHaveText('item');});";
        expect(() => preserveTestIntent(before, before.replace("expected='item'", "expected='anything'"), 'tests/app.spec.js')).toThrow('infrastructure');
        expect(() => preserveTestIntent(before, before.replace("toHaveText('item')", "toContainText('item')"), 'tests/app.spec.js')).toThrow('assertion');
        expect(() => preserveTestIntent(before, before + "test('new',async({page})=>{await expect(page.getByText('other')).toBeVisible();});", 'tests/app.spec.js')).not.toThrow();
    });
    it('does not expose an already-applied proposal to a missing or unrelated actor',async()=>{
        const client={...createMutationTestClient({rootDir:'unused'}),systemTestProposal:{findFirst:jest.fn().mockResolvedValue({id:'p',state:'APPLIED'})}};
        await expect(applySystemProposal({client,snapshotId:'s',proposalId:'p',userId:'outsider'})).rejects.toMatchObject({statusCode:404});
        await expect(applySystemProposal({client,snapshotId:'s',proposalId:'p'})).rejects.toMatchObject({statusCode:401});
        expect(client.systemTestProposal.findFirst).not.toHaveBeenCalled();
    });
});
