import fs from 'node:fs';
import path from 'node:path';
import {containedPath} from '../services/fullSystemConfig.service.js';
import {ServiceError} from './serviceError.js';

export const resolveProjectPrismaCli = (directory,repositoryRoot) => {
    let current=containedPath(repositoryRoot,path.relative(repositoryRoot,directory));
    while(true) {
        // Prisma 6 declares a bin entry without a package main. Resolving the
        // module name as JavaScript incorrectly reports an installed CLI absent.
        const cli=path.join(current,'node_modules/prisma/build/index.js');
        if(fs.existsSync(cli))return containedPath(repositoryRoot,path.relative(repositoryRoot,fs.realpathSync(cli)));
        if(current===path.resolve(repositoryRoot))break;
        const parent=path.dirname(current);if(parent===current)break;
        current=containedPath(repositoryRoot,path.relative(repositoryRoot,parent));
    }
    throw new ServiceError('Prisma CLI is missing. Add prisma to the application dependencies or devDependencies.',422);
};
