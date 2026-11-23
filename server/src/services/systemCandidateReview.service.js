import { proposalReviewHash } from './systemProposalReview.service.js';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { analyzeSystemTestFile, digest, preserveTestIntent } from './systemTestStaticAnalysis.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import { ServiceError } from '../utils/serviceError.js';

export const candidateReviewedBindings = ({proposal,revision}) => {
    const content=proposal.proposedContent, review=proposal.verificationJson.review;
    if(!review || proposalReviewHash(review)!==review.reviewHash || review.candidateHash!==digest(content) || review.requirementRevisionId!==revision?.id || review.requirementHash!==revision?.contentHash)throw new ServiceError('Candidate review or confirmed requirements changed',409);
    const analysis=analyzeSystemTestFile({content,filePath:proposal.filePath});
    return review.scenarios.flatMap(row=>row.criterionIds.map((criterionId,index)=>{
        const site=analysis.assertionSites.find(item=>item.id===row.assertionIds[index] && item.supported);
        const scenario=analysis.scenarioSites.find(item=>item.line===site?.scenarioLine && item.title===row.title);
        const criterion=revision.contentJson.criteria.find(item=>item.id===criterionId);
        if(!site||!scenario||!criterion)throw new ServiceError('Reviewed assertion mapping is unavailable',409);
        return {id:`candidate-${randomUUID()}`,revisionId:revision.id,criterionId,testFile:proposal.filePath,testHash:digest(content),assertionId:site.id,scenarioId:scenario.id,status:'APPROVED',bindingJson:{expectedOutcome:criterion.expectedOutcome,assertionCode:site.code,assertionHash:site.hash,scenarioTitle:scenario.title}};
    }));
};

export const prepareReviewedCandidate = ({rootDir,proposal,baselineContent}) => {
    preserveTestIntent(baselineContent,proposal.proposedContent,proposal.filePath);
    if(digest(baselineContent)!==proposal.baseTestHash)throw new ServiceError('Baseline tests changed after candidate review',409);
    fs.writeFileSync(containedPath(rootDir,proposal.filePath),proposal.proposedContent,'utf8');
};
