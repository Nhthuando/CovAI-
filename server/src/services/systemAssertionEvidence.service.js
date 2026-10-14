import fs from 'node:fs';
import { analyzeSystemTestFile, digest } from './systemTestStaticAnalysis.service.js';
import { containedPath } from './fullSystemConfig.service.js';

export const instrumentReviewedAssertions = ({ content, filePath, bindings, helperImport }) => {
    const analysis = analyzeSystemTestFile({ content, filePath });
    const replacements = [];
    for (const binding of bindings) {
        if (binding.status !== 'APPROVED' || binding.testFile !== filePath || binding.testHash !== digest(content)) continue;
        const site = analysis.assertionSites.find(site => site.id === binding.assertionId && site.supported);
        const scenario = analysis.scenarioSites.find(scenario => scenario.line === site?.scenarioLine);
        if (!site || !scenario || scenario.id !== binding.scenarioId) continue;
        replacements.push({ start: site.start, end: site.end, code: `__covaiAssertion(${JSON.stringify({ bindingId: binding.id, assertionId: site.id, testHash: binding.testHash, expectedContractHash: digest(binding.bindingJson), testFile: filePath, scenarioTitle: scenario.title })}, async () => { await ${content.slice(site.start, site.end)}; })` });
    }
    let code = content;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) code = code.slice(0, replacement.start) + replacement.code + code.slice(replacement.end);
    if (replacements.length) code = helperImport + '\n' + code;
    return code;
};
export const readAssertionEvents = preparation => {
    const events = [];
    for (const entry of fs.readdirSync(preparation.directory)) if (/^assertion-.*\.json$/.test(entry)) {
        const file = containedPath(preparation.directory,entry);
        if(fs.lstatSync(file).isSymbolicLink()) throw new Error('Assertion artifact symlink is invalid');
        if (fs.statSync(file).size < 64 * 1024) events.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    return events;
};
export const verifyAssertionEvents = ({ bindings, events, testRun, measurementId }) => bindings.map(binding => {
    const matching = events.filter(event => event.measurementId === measurementId && event.bindingId === binding.id && event.assertionId === binding.assertionId && event.testHash === binding.testHash && event.expectedContractHash === digest(binding.bindingJson));
    const scenarios = testRun.scenarios.filter(scenario => scenario.title === binding.bindingJson.scenarioTitle);
    const verified = binding.status === 'APPROVED' && matching.length === 1 && matching[0].outcome === 'passed' && matching[0].scenarioTitle === binding.bindingJson.scenarioTitle && scenarios.length === 1 && scenarios[0].status === 'passed';
    return { bindingId: binding.id, criterionId: binding.criterionId, verified, reason: verified ? null : 'MISSING_OR_INCOMPLETE_REVIEWED_ASSERTION_EVIDENCE', events: matching };
});
