import { isVagueExpectedOutcome } from '../../../shared/systemExpectedOutcome.js';
import { SYSTEM_PROMPT_VERSION } from './systemTestPrompt.service.js';
import { ServiceError } from '../utils/serviceError.js';
export const buildSystemGenerationInput = ({context,requirements=null,existingTests=[],targetRoutes=[],gapIds=[],executionMode='frontend',runtimeCapabilities={}}) => ({schemaVersion:1,promptVersion:SYSTEM_PROMPT_VERSION,mode:executionMode,requirements,sourceFiles:context.sourceCode,omittedFiles:context.omittedFiles||[],targets:{routes:targetRoutes,gapIds},existingTests,runtimeCapabilities,unknowns:context.omittedFiles?.length?['Some source files were omitted; their contracts are unknown.']:[]});

export const parseSystemGenerationResponse = (raw,{titles=[],requirements=null,sourcePaths=[]}={}) => {
    let parsed;
    try{parsed=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{return {scenarios:[],metadataStatus:'CODE_ONLY'};}
    if(!parsed.scenarios)return {scenarios:[],metadataStatus:'CODE_ONLY'};
    if(!Array.isArray(parsed.scenarios)||parsed.scenarios.length!==titles.length)throw new ServiceError('Generated metadata must describe each executable scenario exactly once',422);
    const seen=new Set(),ids=new Set();
    for(const row of parsed.scenarios) {
        if(!titles.includes(row.title)||seen.has(row.title)||typeof row.id!=='string'||!row.id||ids.has(row.id))throw new ServiceError('Generated scenario identities do not match test code',422);
        seen.add(row.title);ids.add(row.id);
        for(const field of ['criterionIds','preconditions','inputs','actions','expected','sourceReferences'])if(!Array.isArray(row[field])||row[field].some(value=>typeof value!=='string'||!value.trim()))throw new ServiceError('Generated scenario metadata is invalid',422);
        if(row.expected.some(isVagueExpectedOutcome))throw new ServiceError('Expected outcomes must name the affected item and its resulting state or value',422);
        if(!row.expected.length||!row.actions.length||!row.sourceReferences.length)throw new ServiceError('Generated scenarios need expected outcomes, actions and source references',422);
        if(row.criterionIds.some(id=>!requirements?.criteria?.some(criterion=>criterion.id===id)))throw new ServiceError('Generated metadata references unconfirmed criteria',422);
        if(row.sourceReferences.some(name=>!sourcePaths.includes(name)))throw new ServiceError('Generated metadata references an unavailable source file',422);
    }
    return {scenarios:parsed.scenarios,metadataStatus:'DRAFT'};
};
