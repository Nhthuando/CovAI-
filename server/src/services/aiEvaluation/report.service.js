import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { runFor, must } from './management.service.js';
import { hash, TERMINAL, fail } from './common.js';
import { readEvidencePayload } from './artifactStore.service.js';

export async function getRunReport(db, projectId, runId) {
    await runFor(db, projectId, runId);
    const run = await db.aiEvaluationRun.findUnique({ where: { id: runId }, include: { cases: { include: { testCase: true, criteria: { include: { reviews: { orderBy: { createdAt: 'desc' } } } } } }, evidence: { orderBy: { createdAt: 'asc' } } } });
    const { leaseToken, leaseUntil, ...report } = run;
    report.evidence = await Promise.all(report.evidence.map(async e => ({ ...e, payload: await readEvidencePayload(projectId, runId, e.payload) })));
    return { ...report, limitations: ['Results apply to the frozen benchmark and observed target responses.', 'Tool evidence covers COVAI gateway calls only; off-gateway target actions cannot be certified absent.', 'Target model/version and usage metadata are target-reported when available.'] };
}
export async function compareRuns(db, projectId, ids) {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) fail('INVALID_COMPARISON', 'Choose two to four distinct evaluation runs');
    const reports = await Promise.all(ids.map(id => getRunReport(db, projectId, id)));
    const contract = report => hash({ profileVersionId: report.profileVersionId, profile: report.manifest.profileHash, cases: [...report.manifest.caseHashes].sort(), versions: report.manifest.versions, limits: report.manifest.limits, scoring: report.manifest.scoring, judge: report.manifest.judge, actualJudges: [...new Set(report.cases.flatMap(c => c.criteria.filter(r => r.method === 'semantic').map(r => JSON.stringify({ requestedModel: r.evaluator.requestedModel, actualModel: r.evaluator.actualModel, promptVersion: r.evaluator.promptVersion }))))].sort() });
    const compatible = reports.every(r => contract(r) === contract(reports[0]));
    const complete = reports.every(r => r.executionStatus === 'COMPLETED' && r.verdict !== 'INCOMPLETE' && !r.summary?.partial && r.summary?.score !== null);
    return { compatible, rankable: compatible && complete, warning: !compatible ? 'Evaluation contracts differ; results are not directly comparable.' : !complete ? 'At least one run has incomplete evidence or execution.' : null, runs: reports.map(r => ({ id: r.id, targetVersionId: r.targetVersionId, executionStatus: r.executionStatus, verdict: r.verdict, summary: r.summary, createdAt: r.createdAt })) };
}
export async function calibration(db, projectId, profileId) {
    must(await db.aiEvaluationProfile.findFirst({ where: { id: profileId, projectId } }));
    const criteria = await db.aiEvaluationCriterionResult.findMany({ where: { caseResult: { run: { projectId, profileVersion: { profileId }, executionStatus: { in: TERMINAL } } } }, include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 }, caseResult: { include: { testCase: true } } } });
    const reviewed = criteria.filter(c => c.reviews.length);
    const comparable = reviewed.filter(c => ['PASSED', 'FAILED'].includes(c.status) && ['PASSED', 'FAILED'].includes(c.reviews[0].verdict));
    const numeric = reviewed.filter(c => Number.isFinite(c.score) && Number.isFinite(c.reviews[0].score));
    return { total: criteria.length, reviewed: reviewed.length, comparable: comparable.length, agreementRate: comparable.length ? comparable.filter(c => c.status === c.reviews[0].verdict).length / comparable.length : null, meanAbsoluteScoreDifference: numeric.length ? numeric.reduce((sum, c) => sum + Math.abs(c.score - c.reviews[0].score), 0) / numeric.length : null, highRiskDisagreements: comparable.filter(c => c.caseResult.testCase.definition.risk === 'HIGH' && c.status !== c.reviews[0].verdict).map(c => c.id), status: reviewed.length < criteria.length || !comparable.length ? 'INCOMPLETE' : 'REVIEWED', limitation: 'Descriptive statistics for the reviewed cases only. Representativeness and statistical validity have not been certified.' };
}
export function renderEvaluationPdf(report) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 45, size: 'A4' });
        const chunks = []; doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
        doc.font(fileURLToPath(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
        doc.fontSize(18).text('COVAI - Chatbot Evaluation');
        doc.moveDown().fontSize(10).text(`Run: ${report.id}\nExecution: ${report.executionStatus}\nVerdict: ${report.verdict}\nScore: ${report.summary?.score ?? 'N/A'}${report.summary?.partial ? ' (partial)' : ''}\nCompleteness: ${report.summary?.completeness?.scored ?? 0}/${report.summary?.completeness?.applicable ?? 0}`);
        for (const limitation of report.limitations) doc.moveDown().text(limitation);
        for (const c of report.cases) {
            doc.addPage().fontSize(13).text(`${c.testCase.caseKey}: ${c.testCase.definition.title}`);
            doc.fontSize(10).text(`Task: ${c.testCase.taskType}\nExecution: ${c.executionStatus}\nVerdict: ${c.verdict}`);
            for (const r of c.criteria) doc.moveDown().text(`${r.criterionKey}: ${r.status} (${r.score ?? 'N/A'})\n${r.reason}\nExpected: ${JSON.stringify(r.details.expected).slice(0, 2000)}\nEvidence: ${r.evidenceRefs.join(', ')}`);
            for (const e of report.evidence.filter(e => e.caseResultId === c.id && e.kind === 'CONVERSATION')) doc.moveDown().text(`Observed: ${JSON.stringify(e.payload).slice(0, 5000)}\nEvidence hash: ${e.contentHash}`);
        }
        doc.moveDown().text('Long evidence is excerpted in this PDF. Download the JSON report for complete evidence and version manifests.');
        doc.end();
    });
}
