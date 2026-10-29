import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { assessSystemWorkspace } from '../server/src/services/systemAssessmentJob.service.js';
import { analyzeSystemTestFile, digest } from '../server/src/services/systemTestStaticAnalysis.service.js';
import { createAssessmentWorkspace, snapshotIdentity } from '../server/src/services/systemAssessmentWorkspace.service.js';
import { enumerateMutations, classifyMutation } from '../server/src/services/systemMutation.service.js';
import { optimizeSystemTest } from '../server/src/services/systemTestBooster.service.js';
import { compareSystemAssessments } from '../server/src/services/systemAssessment.service.js';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(repository, 'server/src/tests/fixtures/system-assessment');
const original = snapshotIdentity(fixture);
const revision = { id: 'fixture-confirmed', status: 'CONFIRMED', approvedByUserId: 'fixture-owner', contentJson: JSON.parse(fs.readFileSync(path.join(fixture, 'requirements.json'), 'utf8')) };
const filePath = 'tests/strong.spec.js', content = fs.readFileSync(path.join(fixture, filePath), 'utf8');
const sites = analyzeSystemTestFile({ content, filePath });
const bindings = sites.assertionSites.map((site, index) => {
    const scenario = sites.scenarioSites.find(s => s.line === site.scenarioLine);
    return { id: `fixture-binding-${index}`, status: 'APPROVED', criterionId: scenario.title.startsWith('create') ? 'CREATE_VALID' : 'REJECT_BLANK', testFile: filePath, testHash: digest(content), assertionId: site.id, scenarioId: scenario.id, bindingJson: { scenarioTitle: scenario.title, expectedOutcome: scenario.title.startsWith('create') ? revision.contentJson.criteria[0].expectedOutcome : revision.contentJson.criteria[1].expectedOutcome, assertionCode: site.code } };
});
const input = { testFiles: [filePath], runner: 'playwright', executionMode: 'full', repeatRuns: 2, coverageScope: { frontend: { root: 'client', sourceDirectory: 'src' }, backend: { root: 'server', sourceDirectory: 'src' } } };
const output = path.join(repository, 'temp/system-assessment-validation'); fs.mkdirSync(output, { recursive: true });
const progress = async message => console.log(message);
if(process.argv.includes('--typescript-only')) {await verifyTypescriptFixture();assert.deepEqual(snapshotIdentity(fixture),original);process.exit(0);}
const baseline = await assessSystemWorkspace({ rootDir: fixture, input, revision, bindings, onProgress: progress });
fs.writeFileSync(path.join(output, 'baseline.json'), JSON.stringify(baseline, null, 2));
assert.equal(baseline.stability.passedRuns, 2);
assert.equal(baseline.coverage.tiers.frontend.status, 'MEASURED');
assert.equal(baseline.coverage.tiers.backend.status, 'MEASURED');
assert.equal(baseline.requirements.verified, 2);
for (const tier of ['frontend', 'backend']) assert(baseline.coverage.tiers[tier].files.some(file => /lazy|unvisited/.test(file.filePath) && file.counters.lines.covered === 0));
console.log('Full Stack baseline: 2/2 runs; both tiers measured; 2/2 criteria verified.');
const workspace = createAssessmentWorkspace({ rootDir: fixture });
try {
    const file = path.join(workspace.rootDir, 'server/src/valid.js'), before = fs.readFileSync(file, 'utf8');
    const fault = enumerateMutations({ content: before, filePath: 'server/src/valid.js' })[0];
    const marked = `((globalThis.__covaiMutations ||= new Set()).add(${JSON.stringify(fault.id)}),(${fault.replacement}))`;
    fs.writeFileSync(file, before.slice(0, fault.start) + marked + before.slice(fault.end));
    const strong = await assessSystemWorkspace({ rootDir: workspace.rootDir, input: { ...input, repeatRuns: 1 }, revision, bindings, onProgress: progress });
    fs.writeFileSync(path.join(output, 'strong-mutant.json'), JSON.stringify(strong, null, 2));
    assert(strong.runs[0].criterionEvidence.some(e => e.criterionId === 'REJECT_BLANK' && e.events.some(event => event.outcome === 'failed')));
    assert(strong.runs[0].mutationActivations.includes(fault.id));
    const failure = strong.runs[0].criterionEvidence.find(e => e.criterionId === 'REJECT_BLANK');
    assert.equal(classifyMutation({ startupHealthy: true, activated: true, targetExecuted: true, assertionFailures: [{ bindingId: failure.bindingId }], approvedTargetBindingIds: [failure.bindingId] }).status, 'KILLED_ASSERTION');
    const weak = await assessSystemWorkspace({ rootDir: workspace.rootDir, input: { ...input, testFiles: ['tests/weak.spec.js'], repeatRuns: 1 }, revision, bindings: [], onProgress: progress });
    fs.writeFileSync(path.join(output, 'weak-mutant.json'), JSON.stringify(weak, null, 2));
    assert.equal(weak.stability.passedRuns, 1);
    assert.equal(weak.requirements.verified, 0);
    assert(weak.runs[0].mutationActivations.includes(fault.id));
    assert.equal(classifyMutation({ startupHealthy: true, activated: true, targetExecuted: true }).status, 'SURVIVED');
    console.log('Controlled activated blank-input fault: KILLED_ASSERTION by strong test; SURVIVED by weak body-visibility assertion.');
} finally { workspace.release(); }
assert.deepEqual(snapshotIdentity(fixture), original);
if(process.argv.includes('--improvement')) {
    const candidate=content+"\ntest('missing endpoint returns 404',async({request})=>{const response=await request.get('/not-found');expect(response.status()).toBe(404);});\n";
    const draft=await optimizeSystemTest({rootDir:fixture,filePath,dependencies:{generate:async()=>JSON.stringify({optimizedCode:candidate,explanation:'Proposed missing endpoint case'})}});
    assert.equal(draft.verificationStatus,'NOT_VERIFIED');
    const proposalWorkspace=createAssessmentWorkspace({rootDir:fixture});
    try {
        fs.writeFileSync(path.join(proposalWorkspace.rootDir,filePath),draft.optimizedCode);
        const inherited=bindings.map(binding=>({...binding,testHash:digest(candidate)}));
        const after=await assessSystemWorkspace({rootDir:proposalWorkspace.rootDir,input,revision,bindings:inherited,onProgress:progress});
        assert.equal(after.stability.passedRuns,2);
        const comparison=compareSystemAssessments({baseline,candidate:after});
        assert.equal(comparison.comparable,true);
        assert(comparison.coverageDelta.backend.lines > 0);
        assert.deepEqual(comparison.newlyVerifiedCriterionIds,[]);
        fs.writeFileSync(path.join(output,'improvement.json'),JSON.stringify({after,comparison},null,2));
        console.log('Controlled AI response: candidate verified twice; measured backend line hits increase; no unconfirmed requirement is credited.');
    } finally {proposalWorkspace.release();}
}
if(process.argv.includes('--typescript')) await verifyTypescriptFixture();
async function verifyTypescriptFixture() {
    const typedWorkspace=createAssessmentWorkspace({rootDir:fixture});
    try {
        const jsx=path.join(typedWorkspace.rootDir,'client/src/main.jsx');
        const typed=fs.readFileSync(jsx,'utf8').replace('function App()', 'type Item = {name: string};\nfunction App()').replace('useState([])', 'useState<Item[]>([])');
        fs.writeFileSync(path.join(typedWorkspace.rootDir,'client/src/main.tsx'),typed);fs.unlinkSync(jsx);
        const html=path.join(typedWorkspace.rootDir,'client/index.html');fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace('/src/main.jsx','/src/main.tsx'));
        const report=await assessSystemWorkspace({rootDir:typedWorkspace.rootDir,input,revision,bindings,onProgress:progress});
        assert.equal(report.stability.passedRuns,2);
        assert.equal(report.coverage.tiers.frontend.status,'MEASURED');
        assert(report.coverage.tiers.frontend.files.some(file=>file.filePath.endsWith('main.tsx') && file.counters.lines.covered > 0));
        fs.writeFileSync(path.join(output,'typescript.json'),JSON.stringify(report,null,2));
        console.log('TSX Vite runtime: two clean Full Stack runs; measured counters map to original main.tsx.');
    } finally {typedWorkspace.release();}
}
console.log('Original fixture unchanged. Raw reports saved in temp/system-assessment-validation.');
