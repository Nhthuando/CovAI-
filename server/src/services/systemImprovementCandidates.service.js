import {parse} from '@babel/parser';
import {analyzeSystemTestFile,preserveTestIntent,validateAdditionalTestQuality} from './systemTestStaticAnalysis.service.js';

// Only experimental top-level tests can be removed. Original/accepted tests,
// helpers, hooks and imports remain protected by the full preservation check.
const additions=(before,after,filePath)=>{
    preserveTestIntent(before,after,filePath);
    const old=new Set(analyzeSystemTestFile({content:before,filePath}).scenarioSites.map(s=>s.title));
    const sites=analyzeSystemTestFile({content:after,filePath}).scenarioSites.filter(s=>!old.has(s.title));
    const body=parse(after,{sourceType:'module',plugins:['typescript','jsx']}).program.body;
    return sites.map(site=>({...site,declaration:body.find(node=>node.type==='ExpressionStatement' && node.expression.start===site.start && node.expression.end===site.end)}));
};
const without=(content,sites)=>sites.slice().sort((a,b)=>b.declaration.start-a.declaration.start).reduce((text,site)=>text.slice(0,site.declaration.start)+text.slice(site.declaration.end),content);

export const retainValidAdditionalTests=(before,after,filePath)=>{
    const sites=additions(before,after,filePath),rejected=[];
    for(const site of sites){
        try{validateAdditionalTestQuality(before,before+'\n'+after.slice(site.start,site.end)+';',filePath);}
        catch(error){if(!site.declaration)throw error;rejected.push({...site,reason:error.message});}
    }
    if(rejected.length===sites.length)validateAdditionalTestQuality(before,after,filePath);
    const content=without(after,rejected);
    preserveTestIntent(before,content,filePath);
    const quality=validateAdditionalTestQuality(before,content,filePath);
    return {content,quality,rejected:rejected.map(({title,reason})=>({title,reason}))};
};

export const retainPassedAdditionalTests=(before,after,filePath,report)=>{
    const sites=additions(before,after,filePath);
    const passed=site=>report.runs?.length && report.runs.every(run=>run.testRun?.scenarios?.some(s=>s.testFile===filePath && s.title===site.title && s.status==='passed'));
    const removed=sites.filter(site=>!passed(site));
    if(!removed.length || removed.length===sites.length || removed.some(site=>!site.declaration))return null;
    const content=without(after,removed);
    preserveTestIntent(before,content,filePath);
    const quality=validateAdditionalTestQuality(before,content,filePath);
    return {content,quality};
};
