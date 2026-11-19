import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlatformBenchmark, extractDocumentQuestions, extractProjectBusinessKnowledge } from '../services/aiEvaluation/platformBenchmark.service.js';
import { parse, definitionSchema, caseSchema, validateApproval } from '../services/aiEvaluation/contracts.js';

test('platform owns policy and missing semantic judging cannot become a passing result', () => {
    const benchmark = buildPlatformBenchmark({ discovery: { candidates: [{ requestField: 'messages' }] }, nonce: 'fixture' });
    assert.equal(benchmark.policyProvenance, 'COVAI_MANAGED');
    assert.equal(benchmark.definition.judge.enabled, false);
    assert.ok(benchmark.cases.some(c => c.criteria.some(r => r.required && r.method === 'semantic')));
    assert.ok(benchmark.unavailable.some(c => c.criterion === 'project-correctness'));
    validateApproval(parse(definitionSchema, benchmark.definition), benchmark.cases.map(c => parse(caseSchema, c)));
});
test('explicit FAQ pairs provide traceable project ground truth, code blocks do not', () => {
    const pairs = extractDocumentQuestions([{ file: 'docs/faq.md', content: '# FAQ\n### How long can I return orders?\nWithin seven days.\n```js\nQ: Invented question?\nA: Invented answer\n```' }, { file: 'chat.js', content: 'Q: Wrong question?\nA: Wrong answer' }]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].expected, 'Within seven days.');
    assert.equal(pairs[0].provenance, 'PROJECT_DOCUMENTATION');
});
test('no multi-turn contract yields missing evidence instead of fabricated context capability', () => {
    const benchmark = buildPlatformBenchmark({ discovery: { candidates: [{ requestField: 'message' }] } });
    assert.ok(!benchmark.cases.some(c => c.caseKey === 'conversation-context'));
    assert.ok(benchmark.unavailable.some(c => c.criterion === 'context-retention' && c.status === 'INSUFFICIENT_EVIDENCE'));
});

test('business policy and usage sections produce project-specific grounded cases with source locations', () => {
    const sources = [{ file: 'docs/rules.md', content: '# Policy\n## Returns\nReturns are allowed within seven days.\n# Usage Guide: Ordering\n1. Select product.\n2. Confirm address and place order.\n# Development\nRun npm install.\n' }];
    const facts = extractProjectBusinessKnowledge(sources);
    assert.equal(facts.length, 2);
    assert.equal(facts[0].sourceLine, 2);
    assert.ok(!JSON.stringify(facts).includes('npm install'));
    const benchmark = buildPlatformBenchmark({ discovery: { candidates: [{ requestField: 'messages' }] }, sources });
    assert.equal(benchmark.businessAnalysis.groundedCaseCount, 2);
    assert.ok(benchmark.cases.some(item => item.taskType === 'USAGE_GUIDANCE'));
    assert.ok(benchmark.sourceReferences.every(item => item.caseKey && item.sourceHash && item.sourceLine));
    validateApproval(parse(definitionSchema, benchmark.definition), benchmark.cases.map(item => parse(caseSchema, item)));
});

test('structured FAQ knowledge keeps JSON pointers and does not treat arbitrary configuration as ground truth', () => {
    const sources = [{ file: 'data/faq.json', content: JSON.stringify({ faqs: [{ question: 'How do I cancel my order?', answer: 'Cancel from Order history before dispatch.' }] }) }, { file: 'config.json', content: JSON.stringify([{ question: 'Wrong source?', answer: 'Must not become business truth.' }]) }];
    const benchmark = buildPlatformBenchmark({ discovery: { candidates: [{ requestField: 'messages' }] }, sources });
    assert.equal(benchmark.businessAnalysis.groundedCaseCount, 1);
    assert.equal(benchmark.sourceReferences[0].sourcePointer, '/faqs/0');
    assert.equal(benchmark.sourceReferences[0].sourceFile, 'data/faq.json');
});
