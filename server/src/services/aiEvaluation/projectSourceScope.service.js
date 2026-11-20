import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeDiskPath, snapshotWorkspaceRoot } from '../../utils/snapshotWorkspace.js';
import { resolveSystemRepositoryRoot } from '../fullSystemConfig.service.js';
import { fail } from './common.js';

const inside = (root, target) => { const relative = path.relative(root, target); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
async function hasBackend(directory) {
    const markers = ['package.json', 'requirements.txt', 'pyproject.toml', 'app.py', 'main.py', 'langgraph.json'];
    for (const marker of markers) if (await fs.lstat(path.join(directory, marker)).then(stat => stat.isFile() && !stat.isSymbolicLink()).catch(() => false)) return true;
    return false;
}

/** Use the selected application's source, not the archive/repository wrapper. */
export async function projectEvaluationSourceScope(snapshot) {
    const repository = await fs.realpath(snapshotWorkspaceRoot(snapshot));
    const analysis = await fs.realpath(normalizeDiskPath(snapshot.rootDir));
    if (!inside(repository, analysis)) fail('INVALID_SOURCE_SCOPE', 'Selected application is outside its project repository');
    let root = await fs.realpath(resolveSystemRepositoryRoot(analysis));
    let reason = root === analysis ? 'SELECTED_APPLICATION' : 'DECLARED_WORKSPACE_OR_BACKEND_PAIR';
    // A frontend selected during ingestion may need its adjacent server. Include
    // that application pair, without climbing into unrelated cookbook examples.
    if (root === analysis && /^(frontend|client|web)$/i.test(path.basename(analysis))) {
        const parent = path.dirname(analysis);
        if (inside(repository, parent)) for (const name of ['backend', 'server', 'api']) {
            const sibling = path.join(parent, name);
            const real = await fs.realpath(sibling).catch(() => null);
            if (real && inside(parent, real) && await hasBackend(real)) { root = parent; reason = 'FRONTEND_BACKEND_PAIR'; break; }
        }
    }
    if (!inside(repository, root)) fail('INVALID_SOURCE_SCOPE', 'Application workspace is outside its project repository');
    return { root, manifest: { version: 'application-source-scope-v1', repositoryRelativeRoot: path.relative(repository, root).replaceAll('\\', '/') || '.', analysisRelativeRoot: path.relative(root, analysis).replaceAll('\\', '/') || '.', reason } };
}
