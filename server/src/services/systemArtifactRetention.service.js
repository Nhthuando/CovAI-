import fs from 'node:fs/promises';
import { containedPath, resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';
export const SYSTEM_ARTIFACT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const expireSystemArtifacts = async ({client,snapshotId,rootDir,now=new Date()}) => {
    if(!client.systemRunArtifact?.updateMany)return;
    const rows=await client.systemRunArtifact.findMany({where:{assessment:{snapshotId},expiredAt:null,createdAt:{lt:new Date(now.getTime()-SYSTEM_ARTIFACT_RETENTION_MS)}},take:500});
    for(const row of rows) {
        // Persist expiry first: readers cannot treat a removed file as never captured.
        await client.systemRunArtifact.updateMany({where:{id:row.id,expiredAt:null},data:{expiredAt:now}});
        const file=containedPath(resolveSystemRepositoryRoot(rootDir),row.relativePath);
        await fs.rm(file,{force:true});
    }
};
