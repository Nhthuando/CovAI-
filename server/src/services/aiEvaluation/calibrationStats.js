/**
 * Calibration statistics for the AI judge.
 *
 * The judge is treated as a measuring instrument with error. Blind human reviews
 * measure that error (sensitivity / specificity), and pass rates are corrected
 * for it with the Rogan–Gladen estimator. The confidence interval also accounts
 * for the uncertainty of the calibration set itself, following
 * Lee et al., "How to Correctly Report LLM-as-a-Judge Evaluations" (arXiv 2511.21140).
 *
 * Positive class = PASSED. Pure functions only: no database access.
 */

export const MIN_CALIBRATION_PER_CLASS = 10;
const Z95 = 1.959963984540054;

const finiteOrNull = value => (Number.isFinite(value) ? value : null);
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const isBinary = value => value === 'PASSED' || value === 'FAILED';

/**
 * @param {{ judge: 'PASSED'|'FAILED', human: 'PASSED'|'FAILED' }[]} pairs
 */
export function binaryAgreement(pairs = []) {
    const valid = pairs.filter(p => isBinary(p?.judge) && isBinary(p?.human));
    let tp = 0; let fp = 0; let fn = 0; let tn = 0;
    for (const { judge, human } of valid) {
        if (judge === 'PASSED' && human === 'PASSED') tp++;
        else if (judge === 'PASSED' && human === 'FAILED') fp++;
        else if (judge === 'FAILED' && human === 'PASSED') fn++;
        else tn++;
    }
    const n = valid.length;
    const humanPositives = tp + fn;
    const humanNegatives = tn + fp;
    const base = {
        n,
        confusion: { tp, fp, fn, tn },
        humanPositives,
        humanNegatives,
        agreement: null,
        kappa: null,
        kappaCi95: null,
        gwetAc1: null,
        sensitivity: humanPositives ? tp / humanPositives : null,
        specificity: humanNegatives ? tn / humanNegatives : null,
    };
    if (!n) return base;

    const po = (tp + tn) / n;
    const judgePass = (tp + fp) / n;
    const humanPass = (tp + fn) / n;
    const pe = judgePass * humanPass + (1 - judgePass) * (1 - humanPass);
    const kappa = pe < 1 ? (po - pe) / (1 - pe) : null;
    let kappaCi95 = null;
    if (kappa !== null) {
        const se = Math.sqrt((po * (1 - po)) / (n * (1 - pe) ** 2));
        kappaCi95 = [clamp(kappa - Z95 * se, -1, 1), clamp(kappa + Z95 * se, -1, 1)];
    }
    const pi = (judgePass + humanPass) / 2;
    const peAc1 = 2 * pi * (1 - pi);
    const gwetAc1 = peAc1 < 1 ? (po - peAc1) / (1 - peAc1) : null;

    return {
        ...base,
        agreement: po,
        kappa: finiteOrNull(kappa),
        kappaCi95: kappaCi95 && kappaCi95.every(Number.isFinite) ? kappaCi95 : null,
        gwetAc1: finiteOrNull(gwetAc1),
    };
}

/**
 * Rogan–Gladen corrected pass rate with a delta-method 95% CI that includes
 * calibration uncertainty.
 *
 * @param {{ passed: number, evaluated: number }} raw
 * @param {{ sensitivity: number|null, specificity: number|null, humanPositives: number, humanNegatives: number }} calibration
 */
export function correctedPassRate(raw, calibration) {
    const passed = Number(raw?.passed) || 0;
    const evaluated = Number(raw?.evaluated) || 0;
    const p = evaluated > 0 ? passed / evaluated : null;
    const humanPositives = Number(calibration?.humanPositives) || 0;
    const humanNegatives = Number(calibration?.humanNegatives) || 0;

    if (p === null) return { status: 'NO_GRADED_RESULTS', raw: null };
    if (humanPositives < MIN_CALIBRATION_PER_CLASS || humanNegatives < MIN_CALIBRATION_PER_CLASS) {
        return {
            status: 'NOT_ENOUGH_CALIBRATION',
            raw: p,
            humanPositives,
            humanNegatives,
            needed: {
                positives: Math.max(0, MIN_CALIBRATION_PER_CLASS - humanPositives),
                negatives: Math.max(0, MIN_CALIBRATION_PER_CLASS - humanNegatives),
            },
        };
    }
    const q1 = calibration.sensitivity;
    const q0 = calibration.specificity;
    if (!Number.isFinite(q1) || !Number.isFinite(q0) || q0 + q1 <= 1) {
        return { status: 'JUDGE_TOO_WEAK', raw: p, sensitivity: finiteOrNull(q1), specificity: finiteOrNull(q0) };
    }
    const denominator = q0 + q1 - 1;
    const theta = clamp((p + q0 - 1) / denominator, 0, 1);
    const variance = (
        (p * (1 - p)) / evaluated
        + ((1 - theta) ** 2 * q0 * (1 - q0)) / humanNegatives
        + (theta ** 2 * q1 * (1 - q1)) / humanPositives
    ) / denominator ** 2;
    const half = Z95 * Math.sqrt(variance);
    return {
        status: 'CORRECTED',
        raw: p,
        corrected: theta,
        ci95: [clamp(theta - half, 0, 1), clamp(theta + half, 0, 1)],
        sensitivity: q1,
        specificity: q0,
        humanPositives,
        humanNegatives,
    };
}

/** Stable identity of the judge configuration a criterion result was graded with. */
export function judgeVersionOf(evaluator) {
    if (!evaluator || typeof evaluator !== 'object') return null;
    const model = evaluator.requestedModel || evaluator.model || null;
    const promptVersion = evaluator.promptVersion || null;
    if (!model || !promptVersion) return null;
    return { model, promptVersion };
}

const versionKey = version => (version ? `${version.model}::${version.promptVersion}` : null);

/**
 * Builds per-criterion agreement from review rows restricted to one judge version.
 * rows: [{ criterionKey, status, evaluator, humanVerdict }]
 * If targetVersion is omitted, the most common judge version among the rows is used.
 */
export function calibrationByCriterion(rows = [], targetVersion = null) {
    const counts = new Map();
    for (const row of rows) {
        const key = versionKey(judgeVersionOf(row.evaluator));
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    let chosenKey = versionKey(targetVersion);
    if (!chosenKey) {
        chosenKey = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    }
    const inScope = rows.filter(row => versionKey(judgeVersionOf(row.evaluator)) === chosenKey);
    const byKey = new Map();
    for (const row of inScope) {
        if (!byKey.has(row.criterionKey)) byKey.set(row.criterionKey, []);
        byKey.get(row.criterionKey).push({ judge: row.status, human: row.humanVerdict });
    }
    const byCriterion = {};
    for (const [key, pairs] of byKey) byCriterion[key] = binaryAgreement(pairs);
    const [model, promptVersion] = chosenKey ? chosenKey.split('::') : [null, null];
    return {
        judgeVersion: chosenKey ? { model, promptVersion } : null,
        excludedOtherJudgeVersions: rows.length - inScope.length,
        overall: binaryAgreement(inScope.map(row => ({ judge: row.status, human: row.humanVerdict }))),
        byCriterion,
    };
}
