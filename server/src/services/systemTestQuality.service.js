import {ServiceError} from '../utils/serviceError.js';

export const SYSTEM_TEST_QUALITY_RULES = `Scenario quality requirements:
- One test must verify ONE primary behavior and ONE expected outcome. Generate separate tests for CREATE, DELETE, UPDATE, TOGGLE, CANCEL and each distinct validation case supported by source. Do not combine add/reload/delete into one scenario, edit/cancel into one scenario, or toggle-on/toggle-off into one scenario. Reload may verify persistence of the same outcome.
- Tests must be independent. Create unique prerequisite records inside each delete/update/toggle test; never depend on a previous create test. Label prerequisites as Setup, not as another behavior under test.
- Use these named awaited test.step phases in order: 'Setup: ...' (optional), EXACTLY ONE 'Action: CREATE|DELETE|UPDATE|TOGGLE|CANCEL|VALIDATION|READ|NAVIGATION|OTHER - description', one or more 'Assert: ...', 'Evidence: verified outcome', then optional 'Cleanup: ...'. Pick one operation token, not a list. Navigation and prerequisite creation belong in Setup. The Action block performs only the primary behavior; Assert checks its specific outcome, including reload persistence when applicable.
- Inside Evidence, attach await page.screenshot() using await test.info().attach('evidence', {body: await page.screenshot(), contentType:'image/png'}). Capture AFTER outcome assertions and BEFORE cleanup so create evidence shows the created item and delete evidence shows it removed. If cleanup is necessary, put it after Evidence, ideally in finally; never turn cleanup into a second main behavior.
- Assert actual postconditions, not just body visibility: created/updated row text, deleted row absence, completion state, or the specific invalid-input rejection. Missing controls must fail. Do not use isVisible/isEnabled conditional fallbacks to skip actions or assertions. Do not click page.locator('button').first()/nth() or an unnamed global getByRole('button').first(); scope to the correct form or row from source and assert actionability.
- Return only cases justified by source; do not invent business rules. A passing suite demonstrates those cases, not complete business coverage.`;

const visit = (node, callback) => {
    if(!node || typeof node !== 'object') return;
    callback(node);
    for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(child=>visit(child,callback));else if(value?.type) visit(value,callback);
};
const member = node => node?.type === 'MemberExpression' ? node.property?.name || node.property?.value : null;
const fail = (title,reason) => {throw new ServiceError(`Scenario "${title}" fails quality validation: ${reason}`,422);};

export const validateSystemTestQuality = ast => {
    const scenarios=[];
    visit(ast,node=>{
        if(node.type !== 'CallExpression' || node.callee?.name !== 'test') return;
        const title=node.arguments[0]?.value;
        const phases=[];
        visit(node.arguments.at(-1),child=>{
            if(child.type === 'CallExpression' && member(child.callee) === 'step' && child.callee.object?.name === 'test') {
                const label=child.arguments[0]?.value;
                const phase=typeof label === 'string' ? label.match(/^(Setup|Action|Assert|Evidence|Cleanup):\s*(.+)$/) : null;
                if(!phase) fail(title,'every step must identify its Setup/Action/Assert/Evidence/Cleanup phase');
                phases.push({kind:phase[1],label:phase[2],callback:child.arguments.at(-1),start:child.start});
            }
        });
        const actions=phases.filter(phase=>phase.kind==='Action');
        if(actions.length!==1) fail(title,'use exactly one Action step; split independent behaviors into separate tests');
        const operation=actions[0].label.match(/^(CREATE|DELETE|UPDATE|TOGGLE|CANCEL|VALIDATION|READ|NAVIGATION|OTHER)\s+-\s+.+$/)?.[1];
        if(!operation) fail(title,'Action must declare one supported operation token and a description');
        const assertions=phases.filter(phase=>phase.kind==='Assert');
        const evidence=phases.filter(phase=>phase.kind==='Evidence');
        if(!assertions.length || !evidence.length) fail(title,'include outcome assertions and evidence before cleanup');
        const actionStart=actions[0].start;
        const evidenceStart=evidence[0].start;
        if(phases.some(phase=>phase.kind==='Setup' && phase.start>actionStart) || assertions.some(phase=>phase.start<actionStart || phase.start>evidenceStart) || phases.some(phase=>phase.kind==='Cleanup' && phase.start<evidenceStart)) fail(title,'phase order must be Setup, Action, Assert, Evidence, Cleanup');
        let postcondition=false, screenshot=false;
        for(const phase of phases) visit(phase.callback,child=>{
            if(phase.kind==='Assert' && child.type==='CallExpression' && child.callee?.name==='expect') {
                if(['BooleanLiteral','NumericLiteral','StringLiteral'].includes(child.arguments[0]?.type)) fail(title,'assert application outcomes instead of constants');
                postcondition=true;
            }
            if(phase.kind==='Evidence' && child.type==='CallExpression' && member(child.callee)==='attach' && child.arguments[0]?.value==='evidence') {
                const properties=child.arguments[1]?.properties || [];
                const body=properties.find(property=>(property.key?.name||property.key?.value)==='body')?.value;
                let capturesPage=false;
                visit(body, value=>{if(value.type==='CallExpression' && member(value.callee)==='screenshot' && value.callee.object?.name==='page') capturesPage=true;});
                if(properties.some(property=>(property.key?.name||property.key?.value)==='contentType' && property.value?.value==='image/png') && capturesPage) screenshot=true;
            }
            if(['Action','Assert'].includes(phase.kind) && child.type==='CallExpression' && ['isVisible','isEnabled'].includes(member(child.callee))) fail(title,'use web-first assertions instead of conditional visibility/actionability fallbacks');
            if(child.type==='CallExpression' && ['first','nth','last'].includes(member(child.callee))) {
                const target=child.callee.object;
                if(target?.type==='CallExpression' && target.callee?.object?.name==='page' && ((member(target.callee)==='locator' && /^button(?:\s|$)/.test(target.arguments[0]?.value || '')) || (member(target.callee)==='getByRole' && target.arguments[0]?.value==='button' && !target.arguments[1]))) fail(title,'do not select a global button by position; scope to its form or row');
            }
        });
        if(!postcondition || !screenshot) fail(title,'Assert needs an expectation and Evidence must attach an outcome PNG named evidence');
        const behaviors=['create','add','delete','remove','edit','update','cancel','toggle'].filter(word=>new RegExp(`\\b${word}\\b`,'i').test(title));
        const categories=new Set(behaviors.map(word=>['create','add'].includes(word)?'create':['delete','remove'].includes(word)?'delete':['edit','update'].includes(word)?'update':word));
        if(categories.size>1 && /\b(and|then)\b|&/i.test(title)) fail(title,'split combined CRUD outcomes into separate scenario titles');
        scenarios.push({title,operation,evidenceBeforeCleanup:true});
    });
    if(!scenarios.length) throw new ServiceError('Quality validation requires runnable test scenarios',422);
    return {version:1,scenarios};
};
