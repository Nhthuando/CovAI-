/**
 * Deterministic key-fact checking (no AI).
 *
 * Business answers usually hinge on a few exact values: prices, percentages,
 * durations and hotlines. These can be checked by rules instead of by the AI
 * judge, which makes that part of the verdict reproducible and lets us measure
 * how often the judge disagrees with a deterministic oracle.
 *
 * Handles Vietnamese writing conventions: diacritics in either composition,
 * "1.500.000đ", "1,5 triệu", "1tr5", "150k", "7 ngày" vs "1 tuần",
 * "12 tháng" vs "1 năm", hotlines with spaces, dots or dashes.
 * Facts without any number are not checkable here and stay with the AI judge.
 */

export const KEY_FACTS_VERSION = 'key-facts-v1';
export const KEY_FACTS_CRITERION = 'keyFacts';
const NOT_FACT_GROUPS = new Set(['OUT_OF_SCOPE', 'ADVERSARIAL']);

/** Lowercase, compose, then strip diacritics (đ -> d) so units match in any spelling. */
export function plainText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase();
}

/** Parses "1.500.000", "1,5", "1.5", "2,000" using Vietnamese/English separator rules. */
export function parseNumber(raw) {
    const text = String(raw);
    const hasDot = text.includes('.');
    const hasComma = text.includes(',');
    let normalized = text;
    if (hasDot && hasComma) {
        const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
        const thousands = decimal === '.' ? ',' : '.';
        normalized = text.split(thousands).join('').replace(decimal, '.');
    } else if (hasDot || hasComma) {
        const separator = hasDot ? '.' : ',';
        const groups = text.split(separator);
        const thousands = groups.slice(1).every(group => group.length === 3);
        normalized = thousands ? groups.join('') : groups.join('.');
    }
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

const UNIT_PATTERN = [
    'phan tram', 'percent', '%',
    'trieu', 'tr', 'ty', 'nghin', 'ngan', 'k', 'vnd', 'dong', 'd',
    'ngay', 'days', 'day', 'tuan', 'weeks', 'week', 'thang', 'months', 'month', 'nam', 'years', 'year',
    'gio', 'hours', 'hour', 'h', 'phut', 'minutes', 'minute',
].join('|');

const QUANTITY = new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*(${UNIT_PATTERN})?(?![a-z])`, 'g');
const COMPACT_MILLIONS = /(\d+)\s*tr\s*(\d{1,3})(?![\d.,a-z])/g;
const PHONE = /(?:\+84|(?<![\d.,])0|(?<![\d.,])1[89]00)[\d\s.-]{3,16}\d/g;

function classify(value, unit) {
    switch (unit) {
        case '%': case 'phan tram': case 'percent': return { type: 'percent', value };
        case 'trieu': case 'tr': return { type: 'money', value: value * 1e6 };
        case 'ty': return { type: 'money', value: value * 1e9 };
        case 'nghin': case 'ngan': case 'k': return { type: 'money', value: value * 1e3 };
        case 'vnd': case 'dong': case 'd': return { type: 'money', value };
        case 'ngay': case 'day': case 'days': return { type: 'days', value };
        case 'tuan': case 'week': case 'weeks': return { type: 'days', value: value * 7 };
        case 'thang': case 'month': case 'months': return { type: 'months', value };
        case 'nam': case 'year': case 'years': return { type: 'months', value: value * 12 };
        case 'gio': case 'hour': case 'hours': case 'h': return { type: 'hours', value };
        case 'phut': case 'minute': case 'minutes': return { type: 'minutes', value };
        default: return { type: 'number', value };
    }
}

/** Extracts typed quantities ({ type, value, text }) from free text. */
export function extractQuantities(text) {
    let plain = plainText(text);
    const quantities = [];
    plain = plain.replace(PHONE, match => {
        const digits = match.replace(/\D/g, '');
        if (digits.length < 8) return match;
        const normalized = match.startsWith('+84') ? `0${digits.slice(2)}` : digits;
        quantities.push({ type: 'phone', value: normalized, text: match.trim() });
        return ' ';
    });
    plain = plain.replace(COMPACT_MILLIONS, (match, millions, fraction) => {
        const value = Number(millions) * 1e6 + Number(fraction) * 10 ** (6 - fraction.length);
        quantities.push({ type: 'money', value, text: match.trim() });
        return ' ';
    });
    for (const match of plain.matchAll(QUANTITY)) {
        const value = parseNumber(match[1]);
        if (value === null) continue;
        quantities.push({ ...classify(value, match[2] || null), text: match[0].trim() });
    }
    return quantities;
}

const sameValue = (a, b) => (typeof a === 'string' || typeof b === 'string'
    ? String(a) === String(b)
    : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));

function isFound(expected, answerQuantities) {
    return answerQuantities.some(q => {
        if (q.type === expected.type) return sameValue(q.value, expected.value);
        // Answers often drop the unit: "1.500.000" still states the price, "8:00" still states 8h.
        return ['money', 'hours'].includes(expected.type) && q.type === 'number' && sameValue(q.value, expected.value);
    });
}

/** Facts that contain at least one number and can therefore be checked by rules. */
export function checkableFacts(expectedFacts = []) {
    return (Array.isArray(expectedFacts) ? expectedFacts : [])
        .filter(fact => typeof fact === 'string' && fact.trim())
        .map(fact => ({ fact, quantities: extractQuantities(fact) }))
        .filter(entry => entry.quantities.length > 0);
}

/** Checks every checkable fact against one answer text. */
export function checkAnswer(facts, answerText) {
    const answerQuantities = extractQuantities(answerText);
    const found = [];
    const missing = [];
    const conflicts = [];
    for (const { fact, quantities } of facts) {
        const absent = quantities.filter(q => !isFound(q, answerQuantities));
        if (!absent.length) {
            found.push(fact);
            continue;
        }
        missing.push(fact);
        for (const expected of absent) {
            const contradicting = answerQuantities.filter(q => q.type === expected.type && q.type !== 'number');
            if (contradicting.length) conflicts.push({ fact, expected: expected.text, observed: contradicting.map(q => q.text) });
        }
    }
    return { found, missing, conflicts };
}

export function keyFactsApplies(testCase) {
    return Boolean(
        testCase
        && !NOT_FACT_GROUPS.has(testCase.taskType)
        && testCase.referenceUnverified !== true
        && checkableFacts(testCase.expectedFacts).length > 0,
    );
}

const answerText = observation => (observation.responses || [])
    .map(response => (typeof response?.answer === 'string' ? response.answer : ''))
    .join('\n');

/**
 * Criterion result for the deterministic key-fact check, in the same shape as
 * evaluateCase() results. It is optional (required: false), so it never fails a
 * case on its own; it is reported next to the AI judge as an independent oracle.
 */
export function keyFactsCriterionResult(testCase, observations, references = []) {
    if (!keyFactsApplies(testCase)) return null;
    const facts = checkableFacts(testCase.expectedFacts);
    const base = {
        criterionKey: KEY_FACTS_CRITERION,
        method: 'rule',
        evidenceRefs: references,
        evaluator: { version: KEY_FACTS_VERSION, method: 'deterministic' },
    };
    const details = {
        caseKey: testCase.caseKey,
        taskType: testCase.taskType,
        caseWeight: testCase.weight,
        criterionWeight: 1,
        required: false,
        blocking: false,
        expected: { type: KEY_FACTS_CRITERION, facts: facts.map(f => f.fact) },
    };
    const incomplete = observations.length === 0 || observations.some(o => o.errorCode || !o.responses?.length);
    if (incomplete) {
        return {
            ...base,
            status: 'INSUFFICIENT_EVIDENCE',
            score: null,
            reason: 'Key facts need a complete chatbot answer for every repetition',
            details,
        };
    }
    const perRepetition = observations.map(o => checkAnswer(facts, answerText(o)));
    const repetitionVerdicts = perRepetition.map(r => (r.missing.length ? 'FAILED' : 'PASSED'));
    const score = Math.round(
        perRepetition.reduce((sum, r) => sum + r.found.length / facts.length, 0) / perRepetition.length * 100,
    );
    const firstMiss = perRepetition.findIndex(r => r.missing.length);
    const passed = firstMiss === -1;
    const reason = passed
        ? `All ${facts.length} key fact(s) were found in every answer (checked by rules, not AI).`
        : `Answer ${firstMiss + 1} is missing: ${perRepetition[firstMiss].missing.join('; ')}`
            + (perRepetition[firstMiss].conflicts.length
                ? ` (it states ${perRepetition[firstMiss].conflicts[0].observed.join(', ')} instead of ${perRepetition[firstMiss].conflicts[0].expected})`
                : '');
    return {
        ...base,
        status: passed ? 'PASSED' : 'FAILED',
        score,
        reason,
        details: { ...details, repetitionVerdicts, keyFacts: perRepetition },
    };
}
