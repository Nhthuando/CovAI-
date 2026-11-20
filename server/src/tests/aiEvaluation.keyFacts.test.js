import { describe, test, expect } from '@jest/globals';
import {
    checkAnswer,
    checkableFacts,
    extractQuantities,
    keyFactsCriterionResult,
    parseNumber,
} from '../services/aiEvaluation/keyFacts.js';

const kinds = text => extractQuantities(text).map(({ type, value }) => [type, value]);

describe('Deterministic key facts (Vietnamese number formats)', () => {
    test('parses Vietnamese and English separators', () => {
        expect(parseNumber('1.500.000')).toBe(1500000);
        expect(parseNumber('1,5')).toBe(1.5);
        expect(parseNumber('1.5')).toBe(1.5);
        expect(parseNumber('2,000,000')).toBe(2000000);
        expect(parseNumber('1.234,5')).toBe(1234.5);
    });

    test('reads money in every common spelling', () => {
        for (const text of ['1.500.000đ', '1.500.000 đồng', '1,5 triệu', '1tr5', '1500k', '1.500.000 VND']) {
            expect(kinds(text)).toContainEqual(['money', 1500000]);
        }
        expect(kinds('150k')).toContainEqual(['money', 150000]);
    });

    test('reads durations, percentages and hotlines', () => {
        expect(kinds('đổi trả trong 7 ngày')).toContainEqual(['days', 7]);
        expect(kinds('trong 1 tuần')).toContainEqual(['days', 7]);
        expect(kinds('bảo hành 12 tháng')).toContainEqual(['months', 12]);
        expect(kinds('bảo hành 1 năm')).toContainEqual(['months', 12]);
        expect(kinds('giảm 10%')).toContainEqual(['percent', 10]);
        expect(kinds('giảm 10 phần trăm')).toContainEqual(['percent', 10]);
        expect(kinds('gọi 1900-6868')).toContainEqual(['phone', '19006868']);
        expect(kinds('gọi 1900 6868 nhé')).toContainEqual(['phone', '19006868']);
        expect(kinds('số 0901.234.567')).toContainEqual(['phone', '0901234567']);
    });

    test('decomposed (NFD) and composed (NFC) Vietnamese give the same result', () => {
        const nfd = 'Bảo hành 12 tháng'.normalize('NFD');
        expect(kinds(nfd)).toEqual(kinds('Bảo hành 12 tháng'.normalize('NFC')));
    });

    test('facts without numbers are not checkable by rules', () => {
        expect(checkableFacts(['Gói Premium có hỗ trợ ưu tiên', 'Đổi trả trong 7 ngày'])).toHaveLength(1);
    });

    test('finds equivalent values and reports contradictions', () => {
        const facts = checkableFacts(['Đổi trả trong 7 ngày', 'Phí giao hàng 30.000đ']);
        const good = checkAnswer(facts, 'Anh/chị được đổi trả trong 1 tuần, phí giao 30k ạ.');
        expect(good.missing).toEqual([]);
        const bad = checkAnswer(facts, 'Bên em cho đổi trả trong 30 ngày, phí giao 30.000 đồng.');
        expect(bad.missing).toEqual(['Đổi trả trong 7 ngày']);
        expect(bad.conflicts[0]).toMatchObject({ fact: 'Đổi trả trong 7 ngày', observed: ['30 ngay'] });
    });

    test('builds an optional rule-based criterion result with per-repetition verdicts', () => {
        const testCase = {
            caseKey: 'HP-01', taskType: 'HAPPY_PATH', weight: 1,
            expectedFacts: ['Bảo hành 12 tháng', 'Hotline 1900 6868'],
        };
        const observations = [
            { responses: [{ answer: 'Sản phẩm bảo hành 12 tháng, hotline 1900-6868.' }] },
            { responses: [{ answer: 'Bảo hành 6 tháng ạ.' }] },
        ];
        const result = keyFactsCriterionResult(testCase, observations, ['ev1']);
        expect(result.criterionKey).toBe('keyFacts');
        expect(result.method).toBe('rule');
        expect(result.status).toBe('FAILED');
        expect(result.details.required).toBe(false);
        expect(result.details.repetitionVerdicts).toEqual(['PASSED', 'FAILED']);
        expect(result.score).toBe(50);
        expect(result.reason).toContain('Answer 2');

        expect(keyFactsCriterionResult({ ...testCase, taskType: 'ADVERSARIAL' }, observations)).toBeNull();
        expect(keyFactsCriterionResult({ ...testCase, referenceUnverified: true }, observations)).toBeNull();
        expect(keyFactsCriterionResult(testCase, [{ responses: [], errorCode: 'TARGET_HTTP_ERROR' }]).status)
            .toBe('INSUFFICIENT_EVIDENCE');
    });
});
