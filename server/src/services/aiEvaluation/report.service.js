import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { runFor, must } from './management.service.js';
import { hash, TERMINAL, fail, isBehaviorOnly } from './common.js';
import { readEvidencePayload } from './artifactStore.service.js';
import { aggregationInputs } from './evaluator.service.js';
import { aggregateTrustProfile, computeCohensKappa, computeWilsonInterval, representativeScore } from './scoring.service.js';
import { binaryAgreement, calibrationByCriterion, correctedPassRate, judgeVersionOf } from './calibrationStats.js';
import { KEY_FACTS_CRITERION } from './keyFacts.js';

async function reviewedCriterionRows(db, projectId, profileId) {
    const rows = await db.aiEvaluationCriterionResult.findMany({
        where: {
            status: { in: ['PASSED', 'FAILED'] },
            reviews: { some: {} },
            caseResult: {
                run: { projectId, profileVersion: { profileId }, executionStatus: { in: TERMINAL } },
            },
        },
        select: {
            criterionKey: true,
            status: true,
            evaluator: true,
            reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { verdict: true } },
        },
    });
    return rows
        .filter(row => ['PASSED', 'FAILED'].includes(row.reviews[0]?.verdict))
        .map(row => ({
            criterionKey: row.criterionKey,
            status: row.status,
            evaluator: row.evaluator,
            humanVerdict: row.reviews[0].verdict,
        }));
}

function mostCommonJudgeVersion(criteria) {
    const counts = new Map();
    for (const criterion of criteria) {
        const version = judgeVersionOf(criterion.evaluator);
        if (!version) continue;
        const key = `${version.model}::${version.promptVersion}`;
        const entry = counts.get(key) || { version, count: 0 };
        entry.count++;
        counts.set(key, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.version || null;
}

/**
 * Corrects this run's per-criterion pass rates for the AI judge's measured error
 * (Rogan–Gladen). Computed at read time; never persisted.
 */
async function judgeCorrectionFor(db, projectId, run) {
    const graded = run.cases
        .flatMap(c => c.criteria)
        .filter(r => r.method === 'semantic' && ['PASSED', 'FAILED'].includes(r.status));
    const judgeVersion = mostCommonJudgeVersion(graded);
    if (!judgeVersion) return { judgeVersion: null, byCriterion: {} };
    const profileVersion = await db.aiEvaluationProfileVersion.findUnique({
        where: { id: run.profileVersionId },
        select: { profileId: true },
    });
    const rows = profileVersion ? await reviewedCriterionRows(db, projectId, profileVersion.profileId) : [];
    const calibration = calibrationByCriterion(rows, judgeVersion);
    const byCriterion = {};
    for (const key of [...new Set(graded.map(r => r.criterionKey))]) {
        const sameJudge = graded.filter(r => {
            const version = judgeVersionOf(r.evaluator);
            return r.criterionKey === key && version?.model === judgeVersion.model && version?.promptVersion === judgeVersion.promptVersion;
        });
        const stats = calibration.byCriterion[key] || { sensitivity: null, specificity: null, humanPositives: 0, humanNegatives: 0 };
        byCriterion[key] = correctedPassRate(
            { passed: sameJudge.filter(r => r.status === 'PASSED').length, evaluated: sameJudge.length },
            stats,
        );
    }
    return { judgeVersion, byCriterion };
}

export const EVALUATION_DISCLAIMER = 'Automated evaluation results are for reference only (Kết quả đánh giá tự động chỉ mang tính chất tham khảo).';

export async function getRunReport(db, projectId, runId) {
    await runFor(db, projectId, runId);
    const run = await db.aiEvaluationRun.findUnique({
        where: { id: runId },
        include: {
            cases: {
                orderBy: { id: 'asc' },
                include: {
                    testCase: true,
                    criteria: { include: { reviews: { orderBy: { createdAt: 'desc' } } } },
                },
            },
            evidence: { orderBy: { createdAt: 'asc' } },
        },
    });
    const profileVersion = run.profileVersionId && await db.aiEvaluationProfileVersion?.findUnique?.({
        where: { id: run.profileVersionId },
        select: { sourceManifest: true },
    });
    const groundingMode = isBehaviorOnly(profileVersion?.sourceManifest) ? 'BEHAVIOR' : 'DOCUMENTS';
    const { leaseToken, leaseUntil, ...report } = run;
    report.evidence = await Promise.all(
        report.evidence.map(async e => ({ ...e, payload: await readEvidencePayload(projectId, runId, e.payload) })),
    );
    const knowledgeProbeSkipped = Boolean(
        report.summary?.knowledgeProbe?.status !== 'NOT_APPLICABLE'
        && (report.manifest?.skipKnowledgeProbe || report.summary?.knowledgeProbe?.status === 'SKIPPED_BY_USER'),
    );
    const unverifiedReferenceCount = report.cases.filter(c => c.testCase?.definition?.referenceUnverified === true).length;
    const errorCriteriaCount = report.cases.flatMap(c => c.criteria).filter(r => r.status === 'ERROR').length;
    if (report.verdict === 'PASSED' && errorCriteriaCount > 0) {
        if (report.manifest?.scoring?.confirmed) {
            const recomputed = aggregateTrustProfile(
                aggregationInputs(report.cases.flatMap(c => c.criteria)),
                report.manifest.scoring,
            );
            report.verdict = recomputed.verdict;
            if (report.summary && typeof report.summary === 'object') {
                report.summary = {
                    ...report.summary,
                    verdict: recomputed.verdict,
                    errorCriteriaCount: recomputed.errorCriteriaCount,
                    errorCriteria: recomputed.errorCriteria,
                };
            }
        } else {
            report.verdict = 'INCOMPLETE';
            if (report.summary && typeof report.summary === 'object') {
                report.summary = { ...report.summary, verdict: 'INCOMPLETE', errorCriteriaCount };
            }
        }
    }
    const limitations = [
        ...(knowledgeProbeSkipped
            ? ['Knowledge readiness probe was bypassed (skipKnowledgeProbe: true); chatbot knowledge seeding was not verified prior to execution.']
            : []),
        ...(errorCriteriaCount > 0
            ? [`${errorCriteriaCount} evaluation criterion/criteria encountered an execution or Judge error (status: ERROR); overall verdict cannot be PASSED and is marked INCOMPLETE unless a blocking safety gate failed.`]
            : []),
        ...(groundingMode === 'DOCUMENTS' && unverifiedReferenceCount > 0
            ? [`${unverifiedReferenceCount} scenario(s) had unverified source quotes cleared (referenceUnverified: true) because the generated excerpt was not found in the loaded knowledge documents.`]
            : []),
        ...(groundingMode === 'BEHAVIOR'
            ? ['This chatbot has no documents: answers were graded by its role and expected behaviour, not by document facts.']
            : []),
        EVALUATION_DISCLAIMER,
        'Results apply to the frozen benchmark and observed target responses.',
        'Tool evidence covers COVAI gateway calls only; off-gateway target actions cannot be certified absent.',
        'Target model/version and usage metadata are target-reported when available.',
    ];
    // Cross-check: the AI judge's faithfulness verdict vs the rule-based key-fact oracle, per case.
    const oraclePairs = report.cases.flatMap(c => {
        const keyFacts = c.criteria.find(r => r.criterionKey === KEY_FACTS_CRITERION);
        const faithfulness = c.criteria.find(r => r.criterionKey === 'faithfulness');
        return keyFacts && faithfulness ? [{ judge: faithfulness.status, human: keyFacts.status }] : [];
    });
    const oracleAgreement = {
        description: 'AI judge (faithfulness) compared with rule-based key facts on the same answers',
        ...binaryAgreement(oraclePairs),
    };
    let judgeCorrection;
    try {
        judgeCorrection = await judgeCorrectionFor(db, projectId, report);
    } catch (error) {
        console.error('[Evaluation] Judge correction unavailable:', { runId, message: String(error?.message || error).slice(0, 300) });
        judgeCorrection = { judgeVersion: null, byCriterion: {}, status: 'UNAVAILABLE' };
    }
    return {
        ...report,
        groundingMode,
        judgeCorrection,
        oracleAgreement,
        knowledgeProbeSkipped,
        unverifiedReferenceCount,
        errorCriteriaCount,
        limitations,
    };
}

export async function compareRuns(db, projectId, ids) {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) fail('INVALID_COMPARISON', 'Choose two to four distinct evaluation runs');
    const reports = await Promise.all(ids.map(id => getRunReport(db, projectId, id)));
    const contract = report => hash({ agent: report.manifest.agent || null, profileVersionId: report.profileVersionId, profile: report.manifest.profileHash, cases: [...report.manifest.caseHashes].sort(), versions: report.manifest.versions, limits: report.manifest.limits, scoring: report.manifest.scoring, judge: report.manifest.judge, actualJudges: [...new Set(report.cases.flatMap(c => c.criteria.filter(r => r.method === 'semantic').map(r => JSON.stringify({ requestedModel: r.evaluator.requestedModel, actualModel: r.evaluator.actualModel, promptVersion: r.evaluator.promptVersion }))))].sort() });
    const compatible = reports.every(r => contract(r) === contract(reports[0]));
    const complete = reports.every(r => r.executionStatus === 'COMPLETED' && r.verdict !== 'INCOMPLETE' && !r.summary?.partial && r.summary?.score !== null);
    return { compatible, rankable: compatible && complete, warning: !compatible ? 'Evaluation contracts differ; results are not directly comparable.' : !complete ? 'At least one run has incomplete evidence or execution.' : null, runs: reports.map(r => ({ id: r.id, targetVersionId: r.targetVersionId, executionStatus: r.executionStatus, verdict: r.verdict, summary: r.summary, createdAt: r.createdAt })) };
}

export async function calibration(db, projectId, profileId) {
    must(await db.aiEvaluationProfile.findFirst({ where: { id: profileId, projectId }, select: { id: true } }));
    const criteria = await db.aiEvaluationCriterionResult.findMany({
        where: {
            caseResult: {
                run: { projectId, profileVersion: { profileId }, executionStatus: { in: TERMINAL } },
            },
        },
        select: {
            id: true,
            criterionKey: true,
            status: true,
            score: true,
            evaluator: true,
            reviews: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { verdict: true, score: true },
            },
            caseResult: {
                select: {
                    testCase: { select: { definition: true } },
                },
            },
        },
    });
    const reviewed = criteria.filter(c => c.reviews.length);
    const comparable = reviewed.filter(
        c => ['PASSED', 'FAILED'].includes(c.status) && ['PASSED', 'FAILED'].includes(c.reviews[0].verdict),
    );
    const numeric = reviewed.filter(c => Number.isFinite(c.score) && Number.isFinite(c.reviews[0].score));
    const kappaStats = computeCohensKappa(
        comparable.map(c => ({ judgeVerdict: c.status, humanVerdict: c.reviews[0].verdict })),
    );
    const agreedCount = comparable.filter(c => c.status === c.reviews[0].verdict).length;
    const judgeStats = calibrationByCriterion(comparable.map(c => ({
        criterionKey: c.criterionKey,
        status: c.status,
        evaluator: c.evaluator,
        humanVerdict: c.reviews[0].verdict,
    })));
    return {
        judgeVersion: judgeStats.judgeVersion,
        excludedOtherJudgeVersions: judgeStats.excludedOtherJudgeVersions,
        overall: judgeStats.overall,
        byCriterion: judgeStats.byCriterion,
        total: criteria.length,
        reviewed: reviewed.length,
        comparable: comparable.length,
        agreementRate: kappaStats.agreementRate,
        expectedAgreement: kappaStats.expectedAgreement,
        cohensKappa: kappaStats.cohensKappa,
        degenerateMarginals: kappaStats.degenerateMarginals,
        confusionMatrix: kappaStats.confusionMatrix,
        agreementWilson95: comparable.length ? computeWilsonInterval(agreedCount, comparable.length) : null,
        meanAbsoluteScoreDifference: numeric.length
            ? numeric.reduce((sum, c) => sum + Math.abs(c.score - c.reviews[0].score), 0) / numeric.length
            : null,
        highRiskDisagreements: comparable
            .filter(c => c.caseResult.testCase.definition.risk === 'HIGH' && c.status !== c.reviews[0].verdict)
            .map(c => c.id),
        status: reviewed.length < criteria.length || !comparable.length ? 'INCOMPLETE' : 'REVIEWED',
        limitation: 'Descriptive statistics for the reviewed cases only. Representativeness and statistical validity have not been certified. Sensitivity and specificity assume reviewed answers are representative within each scenario group.',
    };
}

export async function getBlindReviewQueue(db, projectId, profileId, { limit = 50 } = {}) {
    must(await db.aiEvaluationProfile.findFirst({ where: { id: profileId, projectId }, select: { id: true } }));
    const boundedLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 50));
    const rows = await db.aiEvaluationCriterionResult.findMany({
        where: {
            status: { in: ['PASSED', 'FAILED'] },
            reviews: { none: {} },
            caseResult: {
                run: { projectId, profileVersion: { profileId }, executionStatus: { in: TERMINAL } },
            },
        },
        orderBy: { id: 'asc' },
        take: Math.min(400, boundedLimit * 4),
        select: {
            id: true,
            criterionKey: true,
            method: true,
            details: true,
            evidenceRefs: true,
            caseResult: {
                select: {
                    id: true,
                    runId: true,
                    testCase: { select: { caseKey: true, taskType: true, definition: true } },
                    run: {
                        select: {
                            evidence: {
                                where: { kind: 'CONVERSATION' },
                                select: { id: true, caseResultId: true, payload: true },
                            },
                        },
                    },
                },
            },
        },
    });

    const groups = new Map();
    for (const row of rows) {
        const type = row.caseResult.testCase.taskType;
        if (!groups.has(type)) groups.set(type, []);
        groups.get(type).push(row);
    }
    const fixedOrder = ['HAPPY_PATH', 'MULTI_TURN', 'OUT_OF_SCOPE', 'ADVERSARIAL'];
    const order = [...fixedOrder, ...[...groups.keys()].filter(type => !fixedOrder.includes(type)).sort()];
    const selected = [];
    for (let index = 0; selected.length < boundedLimit; index++) {
        const round = order.flatMap(type => groups.get(type)?.[index] ? [groups.get(type)[index]] : []);
        if (!round.length) break;
        selected.push(...round.slice(0, boundedLimit - selected.length));
    }
    const items = [];
    for (const row of selected) {
        const caseEvidence = row.caseResult.run.evidence.filter(e => e.caseResultId === row.caseResult.id);
        const conversations = await Promise.all(
            caseEvidence.map(async e => ({
                evidenceId: e.id,
                payload: await readEvidencePayload(projectId, row.caseResult.runId, e.payload),
            })),
        );
        // Intentionally omit AI Judge status, score, reason, and evaluator so human calibration stays blind.
        items.push({
            criterionResultId: row.id,
            runId: row.caseResult.runId,
            caseResultId: row.caseResult.id,
            caseKey: row.caseResult.testCase.caseKey,
            taskType: row.caseResult.testCase.taskType,
            title: row.caseResult.testCase.definition.title,
            turns: row.caseResult.testCase.definition.turns,
            criterionKey: row.criterionKey,
            method: row.method,
            expected: row.details?.expected || null,
            conversations,
        });
    }
    return items;
}

export function renderEvaluationPdf(report) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            margin: 45,
            size: 'A4',
            info: {
                Title: `COVAI Chatbot Evaluation - ${report.id}`,
                Subject: report.knowledgeProbeSkipped
                    ? 'Knowledge Probe: BYPASSED (skipKnowledgeProbe: true) - Reference Only'
                    : 'Knowledge Probe: VERIFIED - Reference Only',
            },
        });
        const chunks = []; doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
        doc.font(fileURLToPath(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
        doc.fontSize(18).text('COVAI - Chatbot Evaluation');
        const passRateLine = report.summary?.scenarioPassRate?.wilson95?.rate != null
            ? `\nScenario Pass Rate: ${report.summary.scenarioPassRate.passed}/${report.summary.scenarioPassRate.evaluated} (${(report.summary.scenarioPassRate.wilson95.rate * 100).toFixed(1)}%, 95% Wilson CI [${(report.summary.scenarioPassRate.wilson95.lower * 100).toFixed(1)}%, ${(report.summary.scenarioPassRate.wilson95.upper * 100).toFixed(1)}%])`
            : '';
        const stabilityLine = report.summary?.stability?.stabilityRate != null
            ? `\nStability (K repetitions): ${report.summary.stability.stableCases}/${report.summary.stability.eligibleCases} (${(report.summary.stability.stabilityRate * 100).toFixed(1)}%)`
            : '';
        const latencyLine = report.summary?.latency?.count
            ? `\nLatency: Avg ${report.summary.latency.avgMs} ms | P50 ${report.summary.latency.p50Ms} ms | P95 ${report.summary.latency.p95Ms} ms (${report.summary.latency.status})`
            : '';
        const probeLine = report.knowledgeProbeSkipped ? '\nKnowledge Probe: BYPASSED (skipKnowledgeProbe: true)' : '';
        const errorLine = report.errorCriteriaCount > 0 ? `\nCriterion Errors: ${report.errorCriteriaCount}` : '';
        const unverifiedLine = report.unverifiedReferenceCount > 0
            ? `\nUnverified Source Quotes Removed: ${report.unverifiedReferenceCount}`
            : '';
        const score = representativeScore(report.summary);
        const scoreNote = score.hidden
            ? ` (only ${score.scored} of ${score.applicable} checks graded)`
            : report.summary?.partial ? ' (partial)' : '';
        doc.moveDown().fontSize(10).text(`Run: ${report.id}\nExecution: ${report.executionStatus}\nVerdict: ${report.verdict}\nScore: ${score.value ?? 'N/A'}${scoreNote}\nCompleteness: ${score.scored}/${score.applicable}${passRateLine}${stabilityLine}${latencyLine}${probeLine}${errorLine}${unverifiedLine}`);
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

export async function exportRunReport(db, projectId, runId, format = 'json') {
    const report = await getRunReport(db, projectId, runId);
    if (!TERMINAL.includes(report.executionStatus)) {
        fail('RUN_ACTIVE', 'Wait for a terminal run before exporting');
    }
    if (format === 'pdf') {
        return {
            contentType: 'application/pdf',
            filename: `chatbot-evaluation-${report.id}.pdf`,
            body: await renderEvaluationPdf(report),
        };
    }
    return {
        contentType: 'application/json',
        filename: `chatbot-evaluation-${report.id}.json`,
        body: JSON.stringify(report, null, 2),
    };
}
