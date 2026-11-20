import { describe, expect, test } from '@jest/globals';
import {
    binaryAgreement,
    calibrationByCriterion,
    correctedPassRate,
} from '../services/aiEvaluation/calibrationStats.js';

const pairsFrom = ({ tp, fp, fn, tn }) => [
    ...Array.from({ length: tp }, () => ({ judge: 'PASSED', human: 'PASSED' })),
    ...Array.from({ length: fp }, () => ({ judge: 'PASSED', human: 'FAILED' })),
    ...Array.from({ length: fn }, () => ({ judge: 'FAILED', human: 'PASSED' })),
    ...Array.from({ length: tn }, () => ({ judge: 'FAILED', human: 'FAILED' })),
];

describe('Judge calibration statistics', () => {
    test('binaryAgreement computes agreement, kappa, AC1, sensitivity and specificity', () => {
        const stats = binaryAgreement(pairsFrom({ tp: 40, fp: 10, fn: 5, tn: 45 }));
        expect(stats.n).toBe(100);
        expect(stats.agreement).toBeCloseTo(0.85, 10);
        // pe = 0.5*0.45 + 0.5*0.55 = 0.5 -> kappa = 0.35 / 0.5
        expect(stats.kappa).toBeCloseTo(0.7, 10);
        expect(stats.sensitivity).toBeCloseTo(40 / 45, 10);
        expect(stats.specificity).toBeCloseTo(45 / 55, 10);
        // pi = (0.50 + 0.45) / 2 = 0.475; peAC1 = 2*0.475*0.525 = 0.49875
        expect(stats.gwetAc1).toBeCloseTo((0.85 - 0.49875) / (1 - 0.49875), 10);
        expect(stats.kappaCi95[0]).toBeLessThan(0.7);
        expect(stats.kappaCi95[1]).toBeGreaterThan(0.7);
        expect(stats.humanPositives).toBe(45);
        expect(stats.humanNegatives).toBe(55);
    });

    test('binaryAgreement never returns NaN for degenerate or empty input', () => {
        const allPass = binaryAgreement(pairsFrom({ tp: 12, fp: 0, fn: 0, tn: 0 }));
        expect(allPass.kappa).toBeNull();
        expect(allPass.specificity).toBeNull();
        expect(Object.values(allPass).some(v => Number.isNaN(v))).toBe(false);
        const empty = binaryAgreement([]);
        expect(empty.n).toBe(0);
        expect(empty.agreement).toBeNull();
        expect(empty.kappa).toBeNull();
    });

    test('correctedPassRate applies Rogan–Gladen and returns a bounded CI', () => {
        const result = correctedPassRate(
            { passed: 80, evaluated: 100 },
            { sensitivity: 0.95, specificity: 0.7, humanPositives: 100, humanNegatives: 100 },
        );
        expect(result.status).toBe('CORRECTED');
        expect(result.raw).toBeCloseTo(0.8, 10);
        expect(result.corrected).toBeCloseTo(0.5 / 0.65, 3);
        expect(result.ci95[0]).toBeLessThanOrEqual(result.corrected);
        expect(result.ci95[1]).toBeGreaterThanOrEqual(result.corrected);
        expect(result.ci95[0]).toBeGreaterThanOrEqual(0);
        expect(result.ci95[1]).toBeLessThanOrEqual(1);
    });

    test('correctedPassRate reports missing calibration and weak judges', () => {
        const notEnough = correctedPassRate(
            { passed: 5, evaluated: 10 },
            { sensitivity: 0.9, specificity: 0.8, humanPositives: 7, humanNegatives: 12 },
        );
        expect(notEnough.status).toBe('NOT_ENOUGH_CALIBRATION');
        expect(notEnough.needed).toEqual({ positives: 3, negatives: 0 });

        const weak = correctedPassRate(
            { passed: 5, evaluated: 10 },
            { sensitivity: 0.4, specificity: 0.5, humanPositives: 20, humanNegatives: 20 },
        );
        expect(weak.status).toBe('JUDGE_TOO_WEAK');

        expect(correctedPassRate({ passed: 0, evaluated: 0 }, {}).status).toBe('NO_GRADED_RESULTS');
    });

    test('calibrationByCriterion keeps one judge version and counts the rest as excluded', () => {
        const v3 = { requestedModel: 'gemini-3.8-flash', promptVersion: 'judge-v3' };
        const v2 = { requestedModel: 'gemini-3.8-flash', promptVersion: 'judge-v2' };
        const rows = [
            { criterionKey: 'faithfulness', status: 'PASSED', evaluator: v3, humanVerdict: 'PASSED' },
            { criterionKey: 'faithfulness', status: 'FAILED', evaluator: v3, humanVerdict: 'FAILED' },
            { criterionKey: 'completeness', status: 'PASSED', evaluator: v3, humanVerdict: 'FAILED' },
            { criterionKey: 'faithfulness', status: 'PASSED', evaluator: v2, humanVerdict: 'FAILED' },
        ];
        const result = calibrationByCriterion(rows);
        expect(result.judgeVersion).toEqual({ model: 'gemini-3.8-flash', promptVersion: 'judge-v3' });
        expect(result.excludedOtherJudgeVersions).toBe(1);
        expect(result.byCriterion.faithfulness.n).toBe(2);
        expect(result.byCriterion.faithfulness.agreement).toBe(1);
        expect(result.byCriterion.completeness.confusion).toEqual({ tp: 0, fp: 1, fn: 0, tn: 0 });
        expect(result.overall.n).toBe(3);

        const forced = calibrationByCriterion(rows, { model: 'gemini-3.8-flash', promptVersion: 'judge-v2' });
        expect(forced.byCriterion.faithfulness.n).toBe(1);
        expect(forced.excludedOtherJudgeVersions).toBe(3);
    });
});
