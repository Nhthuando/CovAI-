import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'yaml';
import {ServiceError} from './serviceError.js';

export const workspacePatterns = (directory,pkg) => {
    if(Array.isArray(pkg.workspaces))return pkg.workspaces;
    if(Array.isArray(pkg.workspaces?.packages))return pkg.workspaces.packages;
    const file=path.join(directory,'pnpm-workspace.yaml');
    if(!fs.existsSync(file))return [];
    try {
        const config=parse(fs.readFileSync(file,'utf8'),{maxAliasCount:50});
        const patterns=config?.packages ?? ['**'];
        if(!Array.isArray(patterns)||patterns.some(value=>typeof value!=='string'))throw new Error();
        return patterns;
    } catch {throw new ServiceError('Invalid pnpm workspace configuration; packages must be a list of directory patterns',422);}
};
export const isWorkspaceMember = (directory,pkg,relative) => {
    const patterns=workspacePatterns(directory,pkg).filter(value=>typeof value==='string');
    const matches=pattern=>path.posix.matchesGlob(relative,String(pattern).replace(/\\/g,'/').replace(/\/$/,''));
    return patterns.some(value=>!value.startsWith('!')&&matches(value)) && !patterns.some(value=>value.startsWith('!')&&matches(value.slice(1)));
};
