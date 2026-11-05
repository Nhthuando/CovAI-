import { SYSTEM_PROMPT_VERSION } from './systemTestPrompt.service.js';
const requestRequirements = instruction => {try{return JSON.parse(instruction)?.requirements || null;}catch{return null;}};
import path from 'node:path';

// Complete files are retained. Missing context is declared, never silently
// represented as a complete project description.
export const focusTestContext = (context, instruction, maxCharacters = 60000) => {
    let request;
    try {request=JSON.parse(instruction);} catch {request={instruction};}
    if(!request || typeof request !== 'object' || Array.isArray(request)) request={instruction:String(instruction || '')};
    const gaps=Array.isArray(request.gaps) ? request.gaps : [];
    const selectedGaps=[], perFile=new Map();
    for(const gap of gaps) {
        const key=gap.filePath || gap.criterionId || gap.kind;
        if((perFile.get(key)||0)>=2) continue;
        perFile.set(key,(perFile.get(key)||0)+1);selectedGaps.push(gap);
        if(selectedGaps.length===8) break;
    }
    const source=context.sourceCode || [];
    const files=new Map(source.map(file=>[file.path,file]));
    const routes=Array.isArray(request.routes)?request.routes:[];
    const references=Array.isArray(request.references)?request.references:[];
    const routeFiles=source.filter(file=>routes.some(route=>route!=='/' && file.content.includes(route)) || references.includes(file.path)).map(file=>file.path);
    const priorities=[...new Set([...selectedGaps.map(gap=>gap.filePath).filter(file=>files.has(file)),...routeFiles])];
    const queue=[...priorities];
    for(let index=0;index<queue.length && index<30;index++) {
        const file=files.get(queue[index]);
        for(const match of file?.content.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g)||[]) {
            const base=path.posix.normalize(path.posix.join(path.posix.dirname(file.path),match[1]));
            const dependency=[base,...['.js','.jsx','.ts','.tsx','/index.js','/index.jsx','/index.ts','/index.tsx'].map(extension=>base+extension)].find(candidate=>files.has(candidate));
            if(dependency && !queue.includes(dependency)) queue.push(dependency);
        }
    }
    const order=[...queue,...source.filter(file=>/route|controller|schema|\.prisma$|\.sql$|package\.json$|system-test\.json$/.test(file.path)).map(file=>file.path),...files.keys()];
    const sourceCode=[], seen=new Set(), omittedFiles=new Set(context.omittedFiles || []);
    let characters=0;
    for(const name of order) {
        if(seen.has(name))continue;seen.add(name);
        const file=files.get(name);if(!file)continue;
        if(characters+file.content.length>maxCharacters){omittedFiles.add(name);continue;}
        characters+=file.content.length;sourceCode.push(file);
    }
    return {sourceCode,omittedFiles:[...omittedFiles],instruction:JSON.stringify({...request,gaps:selectedGaps}),selectedGapCount:selectedGaps.length,sourceCharacters:characters};
};

export const buildBudgetedTestPrompt = ({filePath,existingCode,instruction,scenarioData,context,mode}) => {
    const focused=focusTestContext(context,instruction);
    const payload={filePath,mode,existingCode,instruction:focused.instruction,failure:scenarioData,configuration:context.configuration,requirements:context.requirements||requestRequirements(instruction),promptVersion:SYSTEM_PROMPT_VERSION,sourceCode:focused.sourceCode,omittedFiles:focused.omittedFiles};
    const prompt=JSON.stringify(payload);
    if(prompt.length>120000) throw new Error('The test and required context exceed the AI prompt budget. Select a smaller test file.');
    return {prompt,...focused,promptCharacters:prompt.length};
};
