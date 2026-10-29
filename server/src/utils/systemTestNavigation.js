import {parse} from '@babel/parser';

// Adapt explicit local AUT origins in an execution copy, preserving URL paths,
// query strings and fragments. External origins and unrelated local services stay intact.
export const relocateSystemTestNavigation = (code, origin) => {
    const ast=parse(code,{sourceType:'module',plugins:['typescript','jsx']});
    const nodes=[];
    const visit=node=>{
        if(!node || typeof node!=='object')return;
        nodes.push(node);
        for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value?.type)visit(value);
    };
    visit(ast);
    const origins=new Set();
    for(const node of nodes) if(node.type==='CallExpression' && node.callee?.object?.name==='page' && node.callee?.property?.name==='goto' && node.arguments[0]?.type==='StringLiteral') {
        try {const url=new URL(node.arguments[0].value);if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))origins.add(url.origin);}catch { /* Relative navigation already uses baseURL. */ }
    }
    const replacements=[];
    for(const node of nodes) if(node.type==='StringLiteral') {
        try {const url=new URL(node.value);if(origins.has(url.origin)) replacements.push([node.start,node.end,JSON.stringify(origin+url.pathname+url.search+url.hash)]);}catch { /* Not an absolute URL. */ }
    }
    for(const [start,end,value] of replacements.sort((a,b)=>b[0]-a[0]))code=code.slice(0,start)+value+code.slice(end);
    return code;
};
