import fs from 'node:fs';
import { containedPath } from './fullSystemConfig.service.js';
import { analyzeSystemTestFile, digest } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { syncSystemScenarioCatalog, updateScenarioDraft, reviewScenario } from './systemScenarioCatalog.service.js';
import { createAssertionBinding, approveAssertionBinding } from './systemRequirement.service.js';

const required = values => Array.isArray(values) && values.length && values.every(value => typeof value === 'string' && value.trim());
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const proposalReviewHash = review => digest(canonical(Object.fromEntries(Object.entries(review).filter(([key]) => key !== 'reviewHash'))));

export const reviewSystemProposal = async ({ client, snapshotId, rootDir, proposalId, input, userId }) => {
    const proposal = await client.systemTestProposal.findFirst({ where: { id: proposalId, snapshotId }, include: { assessment: true } });
    if (!proposal) throw new ServiceError('Proposal not found', 404);
    if (proposal.state !== 'VERIFIED_IMPROVEMENT' || !proposal.verificationJson?.accepted) throw new ServiceError('Only a verified proposal can be reviewed', 409);
    if (proposal.candidateTestHash !== input.expectedCandidateTestHash || digest(proposal.proposedContent) !== proposal.candidateTestHash) throw new ServiceError('Proposal content changed', 409);
    const source = fs.readFileSync(containedPath(rootDir, proposal.filePath), 'utf8');
    if (digest(source) !== proposal.baseTestHash) throw new ServiceError('Test file changed; verify again', 409);
    const revision = await client.systemRequirementRevision.findFirst({ where: { id: proposal.assessment.requirementRevisionId || '', snapshotId, status: 'CONFIRMED' } });
    if (!revision || revision.contentHash !== input.expectedRequirementHash) throw new ServiceError('Confirmed requirements changed', 409);
    const old = analyzeSystemTestFile({ content: source, filePath: proposal.filePath });
    const next = analyzeSystemTestFile({ content: proposal.proposedContent, filePath: proposal.filePath });
    const titles = new Set(old.scenarioSites.map(site => site.title));
    const added = next.scenarioSites.filter(site => !titles.has(site.title));
    if (!added.length || new Set(added.map(site => site.title)).size !== added.length || input.scenarios.length !== added.length) throw new ServiceError('Review every distinct new scenario', 422);
    for (const candidate of added) {
        const reviewed = input.scenarios.find(item => item.title === candidate.title);
        if (!reviewed || !required(reviewed.flow) || !required(reviewed.inputs) || !required(reviewed.expected) || !reviewed.criterionIds.length || reviewed.assertionIds.length !== reviewed.criterionIds.length || new Set(reviewed.assertionIds).size !== reviewed.assertionIds.length) throw new ServiceError('Flow, Input, Expected and one distinct assertion per criterion are required', 422);
        if (!reviewed.criterionIds.every(id => {
            const criterion = revision.contentJson.criteria.find(item => item.id === id);
            return criterion && reviewed.expected.some(expected => expected.trim().toLocaleLowerCase() === criterion.expectedOutcome.trim().toLocaleLowerCase());
        })) throw new ServiceError('Expected must include each linked confirmed outcome', 422);
        const sites = next.assertionSites.filter(site => site.supported && site.scenarioLine === candidate.line);
        if (!reviewed.assertionIds.every(id => sites.some(site => site.id === id))) throw new ServiceError('Review supported outcome assertions in the candidate', 422);
    }
    const review = { candidateHash: proposal.candidateTestHash, requirementRevisionId: revision.id, requirementHash: revision.contentHash, scenarios: input.scenarios, reviewedByUserId: userId, reviewedAt: new Date().toISOString() };
    review.reviewHash = proposalReviewHash(review);
    return client.systemTestProposal.update({ where: { id: proposal.id }, data: { verificationJson: { ...proposal.verificationJson, review } } });
};

export const registerAppliedProposalReview = async ({ client, snapshotId, rootDir, proposal }) => {
    const review = proposal.verificationJson?.review;
    if (!review || review.candidateHash !== proposal.candidateTestHash || proposalReviewHash(review) !== review.reviewHash) throw new ServiceError('Exact candidate review is missing', 409);
    const revision = await client.systemRequirementRevision.findFirst({ where: { id: review.requirementRevisionId, snapshotId, status: 'CONFIRMED' } });
    if (!revision || revision.contentHash !== review.requirementHash) throw new ServiceError('Confirmed requirements changed', 409);
    const content = fs.readFileSync(containedPath(rootDir, proposal.filePath), 'utf8');
    if (digest(content) !== proposal.candidateTestHash) throw new ServiceError('Applied test changed', 409);
    const { scenarios } = await syncSystemScenarioCatalog({ client, snapshotId, rootDir });
    for (const item of review.scenarios) {
        const scenario = scenarios.find(candidate => candidate.filePath === proposal.filePath && candidate.title === item.title);
        if (!scenario) throw new ServiceError('Reviewed scenario is missing from applied test', 409);
        for (let index = 0; index < item.criterionIds.length; index++) {
            const criterion = revision.contentJson.criteria.find(candidate => candidate.id === item.criterionIds[index]);
            const binding = await createAssertionBinding({ client, snapshotId, rootDir, revisionId: revision.id, input: { criterionId: criterion.id, expectedOutcome: criterion.expectedOutcome, testFile: proposal.filePath, assertionId: item.assertionIds[index] } });
            await approveAssertionBinding({ client, snapshotId, rootDir, bindingId: binding.id, testHash: binding.testHash, bindingHash: digest(binding.bindingJson), userId: review.reviewedByUserId });
        }
        const updated = await updateScenarioDraft({ client, snapshotId, scenarioId: scenario.id, input: { title: item.title, flow: item.flow, inputs: item.inputs, expected: item.expected, criterionIds: item.criterionIds, expectedScenarioHash: scenario.scenarioHash } });
        await reviewScenario({ client, snapshotId, rootDir, scenarioId: scenario.id, expectedScenarioHash: updated.scenarioHash, revisionId: revision.id, expectedRequirementHash: revision.contentHash, assertionIds: item.assertionIds, userId: review.reviewedByUserId });
    }
};
