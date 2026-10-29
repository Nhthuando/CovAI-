import fs from 'node:fs';
import { containedPath } from './fullSystemConfig.service.js';
import { analyzeSystemTestFile, digest } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';

export const createRequirementRevision = async ({ client, snapshotId, content }) => {
    if (new Set(content.criteria.map(criterion => criterion.id)).size !== content.criteria.length) throw new ServiceError('Criterion IDs must be unique', 400);
    const latest = await client.systemRequirementRevision.findFirst({ where: { snapshotId }, orderBy: { revisionNumber: 'desc' } });
    return client.systemRequirementRevision.create({ data: { snapshotId, revisionNumber: (latest?.revisionNumber || 0) + 1, contentJson: content, contentHash: digest(content) } });
};
export const confirmRequirementRevision = async ({ client, snapshotId, revisionId, contentHash, userId }) => {
    const revision = await client.systemRequirementRevision.findFirst({ where: { id: revisionId, snapshotId } });
    if (!revision) throw new ServiceError('Requirement revision not found', 404);
    if (revision.contentHash !== contentHash) throw new ServiceError('Requirement revision changed', 409);
    if(revision.status === 'CONFIRMED') return revision;
    return client.systemRequirementRevision.update({ where: { id: revision.id }, data: { status: 'CONFIRMED', approvedByUserId: userId, approvedAt: new Date() } });
};
export const createAssertionBinding = async ({ client, snapshotId, rootDir, revisionId, input }) => {
    const revision = await client.systemRequirementRevision.findFirst({ where: { id: revisionId, snapshotId, status: 'CONFIRMED' } });
    const criterion = revision?.contentJson.criteria.find(criterion => criterion.id === input.criterionId);
    if (!criterion) throw new ServiceError('Confirmed criterion not found', 404);
    if (criterion.expectedOutcome !== input.expectedOutcome) throw new ServiceError('Binding must reference the confirmed expected outcome', 422);
    const content = fs.readFileSync(containedPath(rootDir, input.testFile), 'utf8');
    const analysis = analyzeSystemTestFile({ content, filePath: input.testFile });
    const assertion = analysis.assertionSites.find(site => site.id === input.assertionId && site.supported);
    const scenario = analysis.scenarioSites.find(site => site.line === assertion?.scenarioLine);
    if (!assertion || !scenario) throw new ServiceError('Assertion execution evidence is unsupported for this site', 422);
    const testHash = digest(content);
    const existing = await client.systemAssertionBinding.findFirst({ where: { revisionId, assertionId: assertion.id, testHash } });
    if (existing) {
        if (existing.criterionId !== input.criterionId || existing.bindingJson.expectedOutcome !== input.expectedOutcome) throw new ServiceError('Assertion is already bound to a different expected outcome', 409);
        return existing;
    }
    return client.systemAssertionBinding.create({ data: { revisionId, criterionId: input.criterionId, testFile: input.testFile, assertionId: assertion.id, scenarioId: scenario.id, testHash, bindingJson: { expectedOutcome: input.expectedOutcome, assertionCode: assertion.code, assertionHash: assertion.hash, scenarioTitle: scenario.title } } });
};
export const approveAssertionBinding = async ({ client, snapshotId, rootDir, bindingId, testHash, bindingHash, userId }) => {
    const binding = await client.systemAssertionBinding.findFirst({ where: { id: bindingId, revision: { snapshotId, status: 'CONFIRMED' } } });
    if (!binding) throw new ServiceError('Binding not found', 404);
    if (binding.testHash !== testHash || digest(binding.bindingJson) !== bindingHash || digest(fs.readFileSync(containedPath(rootDir, binding.testFile), 'utf8')) !== testHash) throw new ServiceError('Assertion or test changed; review again', 409);
    if(binding.status === 'APPROVED') return binding;
    return client.systemAssertionBinding.update({ where: { id: binding.id }, data: { status: 'APPROVED', reviewedByUserId: userId, reviewedAt: new Date() } });
};

export const requirementCoverage = ({ revision, bindings = [], runs = [] }) => {
    if (revision?.status !== 'CONFIRMED') return { status: 'NOT_MEASURED', reason: 'NO_CONFIRMED_REQUIREMENTS', total: null, designed: null, verified: null, designPct: null, verifiedPct: null, criteria: [] };
    const criteria = revision.contentJson.criteria.map(criterion => {
        const required = bindings.filter(binding => binding.criterionId === criterion.id && binding.status === 'APPROVED');
        const designed = required.length > 0;
        const verified = designed && runs.length > 0 && required.every(binding => runs.every(run => run.criterionEvidence.some(evidence => evidence.bindingId === binding.id && evidence.verified)));
        return { ...criterion, designed, verified, bindingIds: required.map(binding => binding.id) };
    });
    const total = criteria.length, designed = criteria.filter(c => c.designed).length, verified = criteria.filter(c => c.verified).length;
    return { status: 'MEASURED', revisionId: revision.id, approvedByUserId: revision.approvedByUserId, total, designed, verified, designPct: total ? Number((100 * designed / total).toFixed(2)) : null, verifiedPct: total ? Number((100 * verified / total).toFixed(2)) : null, criteria };
};
