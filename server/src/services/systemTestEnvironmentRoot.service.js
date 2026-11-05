import path from 'node:path';
import { currentProjectOperation } from './projectOperationWorkspace.service.js';
import { containedPath } from './fullSystemConfig.service.js';

// Operation source copies omit secrets. Resolve only paths inside that operation
// back to its server-owned original workspace; never accept a client root path.
export const systemTestEnvironmentDirectory = (directory, operation = currentProjectOperation()) => {
    if (!operation?.rootDir || !operation.originalRootDir) return directory;
    const relative = path.relative(operation.rootDir, directory);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return directory;
    return containedPath(operation.originalRootDir, relative);
};
