import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

await jest.unstable_mockModule('../config/prisma.js', () => ({ default: {} }));
const { createAssessmentControllers } = await import('../controllers/systemAssessment.controller.js');
const {snapshotIdentity} = await import('../services/systemAssessmentWorkspace.service.js');
const client = { projectSnapshot: { findFirst: jest.fn() }, systemTestAssessment: { findFirst: jest.fn() }, systemRequirementRevision: { findFirst: jest.fn() }, systemTestProposal: { findFirst: jest.fn() } };
const redis = { set: jest.fn().mockResolvedValue('OK'), eval: jest.fn().mockResolvedValue(1), get: jest.fn() };
const controllers = createAssessmentControllers({ client, queue: async () => ({ jobQueue: { client: Promise.resolve(redis) } }) });
const app = express(); app.use(express.json());
app.use((req, res, next) => { if (!req.headers['x-user']) return res.status(401).end(); req.user = { id: req.headers['x-user'] }; next(); });
app.get('/:snapshotId/assessment/:assessmentId', controllers.get);
app.post('/:snapshotId/requirements/:revisionId/confirm', controllers.confirmRequirements);
app.get('/:snapshotId/proposals/:proposalId', controllers.proposal);
app.get('/:snapshotId/proposals', controllers.latestProposal);
beforeEach(() => { jest.clearAllMocks(); process.env.SYSTEM_ASSESSMENT_ENABLED = 'true'; });
describe('Evidence authorization boundaries', () => {
    it('recovers the latest proposal from the owned snapshot after navigation',async()=>{
        client.projectSnapshot.findFirst.mockResolvedValueOnce({id:'snapshot'});
        client.job={findFirst:jest.fn().mockResolvedValue({id:'latest-job'}),findUnique:jest.fn().mockResolvedValue({status:'CANCELED',progress:32,logs:[]})};
        client.systemTestProposal.findFirst.mockResolvedValueOnce({id:'proposal',jobId:'latest-job',state:'VERIFYING'});
        try {
            const response=await request(app).get('/snapshot/proposals').set('x-user','owner');
            expect(response.body.data).toMatchObject({id:'proposal',state:'CANCELED',jobStatus:'CANCELED'});
            expect(client.systemTestProposal.findFirst).toHaveBeenCalledWith({where:{jobId:'latest-job',snapshotId:'snapshot'}});
            expect(client.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{snapshotId:'snapshot',type:'SYSTEM_TEST_IMPROVEMENT'},orderBy:{createdAt:'desc'}}));
        } finally {delete client.job;}
    });
    it('does not search jobs when latest proposal access is unauthorized',async()=>{
        client.projectSnapshot.findFirst.mockResolvedValueOnce(null);
        expect((await request(app).get('/snapshot/proposals').set('x-user','other')).status).toBe(404);
        expect(client.systemTestProposal.findFirst).not.toHaveBeenCalled();
    });
    it('compares assessment hashes at the repository root when a snapshot points to its backend package',async()=>{
        const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-stale-root-'));
        try {
            fs.mkdirSync(path.join(root,'client'));fs.mkdirSync(path.join(root,'server'));
            fs.writeFileSync(path.join(root,'client/package.json'),'{}');fs.writeFileSync(path.join(root,'server/package.json'),'{}');
            client.projectSnapshot.findFirst.mockResolvedValueOnce({id:'snapshot',rootDir:path.join(root,'server')});
            client.systemTestAssessment.findFirst.mockResolvedValueOnce({id:'assessment',...snapshotIdentity(root),requirementRevisionId:null});
            client.systemRequirementRevision.findFirst.mockResolvedValueOnce(null);
            const response=await request(app).get('/snapshot/assessment/assessment').set('x-user','owner');
            expect(response.status).toBe(200);expect(response.body.data.stale).toBe(false);
        } finally {fs.rmSync(root,{recursive:true,force:true});}
    });
    it('returns owned proposal stage progress and bounded verification feedback',async()=>{
        client.projectSnapshot.findFirst.mockResolvedValueOnce({id:'snapshot'});
        client.systemTestProposal.findFirst.mockResolvedValueOnce({id:'proposal',jobId:'job',state:'FAILED_VERIFICATION',verificationJson:{candidate:{stability:{passedRuns:0,runs:2},runs:[]},baseline:{stability:{passedRuns:2,runs:2}}}});
        client.job={findUnique:jest.fn().mockResolvedValue({status:'SUCCESS',progress:100,logs:[{message:'Improvement stage: Comparing test results'}]})};
        try {
            const response=await request(app).get('/snapshot/proposals/proposal').set('x-user','owner');
            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({jobProgress:100,jobStage:'Comparing test results',failureSummary:{candidatePassedRuns:0,candidateRuns:2}});
            expect(client.job.findUnique.mock.calls[0][0].select.logs.take).toBe(100);
        } finally {delete client.job;}
    });
    it('queues Full Stack preparation before review and keeps the selected model',async()=>{
        const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-admit-'));
        try {
            fs.mkdirSync(path.join(root,'client'));fs.mkdirSync(path.join(root,'server'));
            fs.writeFileSync(path.join(root,'client/package.json'),'{}');fs.writeFileSync(path.join(root,'server/package.json'),'{}');
            const localClient={projectSnapshot:{findFirst:jest.fn().mockResolvedValue({id:'snapshot',projectId:'project',rootDir:path.join(root,'server')}),update:jest.fn().mockResolvedValue({})},job:{findFirst:jest.fn().mockResolvedValue(null)},systemTestAssessment:{create:jest.fn().mockResolvedValue({id:'assessment'})}};
            const createJob=jest.fn().mockResolvedValue({id:'job'}),addJobToQueue=jest.fn();
            const local=createAssessmentControllers({client:localClient,createJob,queue:async()=>({getSystemEvidenceRedis:()=>redis,addJobToQueue})});
            const localApp=express();localApp.use(express.json());localApp.use((req,res,next)=>{req.user={id:'owner'};next();});localApp.post('/:snapshotId/prepare',local.prepareCatalog);
            process.env.SYSTEM_MEASURED_COVERAGE_ENABLED='true';
            const response=await request(localApp).post('/snapshot/prepare').set('X-Covai-AI-Model','gemini-2.5-flash').send({executionMode:'full'});
            expect(response.status).toBe(202);
            expect(createJob.mock.calls[0][0].payloadJson).toMatchObject({autoDiscover:true,prepareOnly:true,executionMode:'full',model:'gemini-2.5-flash'});
            expect(localClient.projectSnapshot.update).toHaveBeenCalledWith({where:{id:'snapshot'},data:{rootDir:fs.realpathSync(root)}});
            expect(addJobToQueue).toHaveBeenCalledWith('SYSTEM_TEST_ASSESSMENT','job');
            expect(fs.existsSync(path.join(root,'.covai/system-test.json'))).toBe(false);
        } finally {fs.rmSync(root,{recursive:true,force:true});}
    });
    it('requires authentication', async () => { expect((await request(app).get('/snapshot/assessment/foreign')).status).toBe(401); });
    it('scopes the parent snapshot to the authenticated owner', async () => {
        client.projectSnapshot.findFirst.mockResolvedValueOnce(null);
        expect((await request(app).get('/snapshot/assessment/foreign').set('x-user', 'owner')).status).toBe(404);
        expect(client.projectSnapshot.findFirst).toHaveBeenCalledWith({ where: { id: 'snapshot', project: { OR:[{ownerId:'owner'},{members:{some:{userId:'owner'}}}] } } });
        expect(client.systemTestAssessment.findFirst).not.toHaveBeenCalled();
    });
    it('does not disclose assessments or proposals from another snapshot', async () => {
        client.projectSnapshot.findFirst.mockResolvedValue({ id: 'snapshot', rootDir: '/not-used' });
        client.systemTestAssessment.findFirst.mockResolvedValueOnce(null);
        client.systemTestProposal.findFirst.mockResolvedValueOnce(null);
        expect((await request(app).get('/snapshot/assessment/foreign').set('x-user', 'owner')).status).toBe(404);
        expect((await request(app).get('/snapshot/proposals/foreign').set('x-user', 'owner')).status).toBe(404);
        expect(client.systemTestProposal.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', snapshotId: 'snapshot' } });
    });
    it('cannot confirm a foreign revision', async () => {
        client.projectSnapshot.findFirst.mockResolvedValueOnce({ id: 'snapshot' });
        client.systemRequirementRevision.findFirst.mockResolvedValueOnce(null);
        expect((await request(app).post('/snapshot/requirements/foreign/confirm').set('x-user', 'owner').send({ expectedContentHash: 'hash' })).status).toBe(404);
        expect(client.systemRequirementRevision.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', snapshotId: 'snapshot' } });
    });
});
