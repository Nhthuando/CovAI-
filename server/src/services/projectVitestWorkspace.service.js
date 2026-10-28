import fs from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from '../utils/projectRootResolver.js';
import { currentProjectOperation } from './projectOperationWorkspace.service.js';

export const prepareVitestOperationRoot = root => {
    const resolved = resolveProjectRoot(root) || root;
    if (currentProjectOperation() && !fs.existsSync(path.join(resolved,'package.json'))) {
        const dependencies = JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')).dependencies;
        fs.writeFileSync(path.join(resolved,'package.json'),JSON.stringify({name:'covai-isolated-vitest',private:true,type:'module',
            scripts:{test:'vitest run'},devDependencies:{vitest:dependencies.vitest,'@vitest/coverage-v8':dependencies['@vitest/coverage-v8']}},null,2));
    }
    return resolved;
};

