import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/prisma.js';
import { captureSystemSuiteManifest, suiteDigest } from './systemSuiteManifest.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import { discoverSystemAssessment } from './systemAssessmentDiscovery.service.js';
import { ServiceError } from '../utils/serviceError.js';

// This function is called only inside a guarded operation copy. Its files are never published.
export const prepareHistoricalSuiteRun = async ({rootDir,snapshotId,input,db=prisma}) => {
    const version = await db.systemSuiteVersion.findFirst({where:{snapshotId,id:input.versionId}});
    if(!version)throw new ServiceError('Test version not found',404);
    const current = await captureSystemSuiteManifest({rootDir});
    if(current.sourceHash!==input.expectedSourceHash)throw new ServiceError('Source changed before the historical test check started',409);
    const contents = [];
    for(const file of version.manifestJson) {
        const blob = await db.systemTestBlob.findUnique({where:{sha256:file.sha256}});
        if(!blob || suiteDigest(blob.content)!==file.sha256)throw new ServiceError('Historical test content is unavailable',409);
        contents.push({file,content:blob.content});
    }
    const target = new Set(version.manifestJson.map(file=>file.path));
    for(const file of current.manifest)if(!target.has(file.path))fs.unlinkSync(containedPath(rootDir,file.path));
    for(const {file,content} of contents) {const absolute=containedPath(rootDir,file.path);fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,content,'utf8');}
    const discovered = discoverSystemAssessment({rootDir,runner:input.runner,executionMode:input.executionMode});
    const files = version.manifestJson.filter(file=>file.role==='SPEC').map(file=>file.path);
    if(files.some(file=>!discovered.testFiles.includes(file)))throw new ServiceError('Some historical tests are incompatible with the selected execution mode',422);
    return {input:{...discovered,testFiles:files,versionCheck:true,versionId:version.id,reviewMode:'legacy'},catalog:version.scenarioSnapshotJson.map(row=>({...row,reviewState:'STALE',criterionIds:[]})),version};
};
