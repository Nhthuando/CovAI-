import fs from 'fs';
import path from 'path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist', 'build', '.next', '.turbo', 'storage']);

const hasPackageJson = (dir) => {
    const packageJsonPath = path.join(dir, 'package.json');
    return fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).isFile();
};

const readPackageJson = (dir) => {
    const packageJsonPath = path.join(dir, 'package.json');
    if (!hasPackageJson(dir)) return null;

    try {
        return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (error) {
        return null;
    }
};

const scorePackageJsonCandidate = (dir) => {
    const pkg = readPackageJson(dir) || {};
    const baseName = path.basename(dir).toLowerCase();
    let score = 0;

    if (['server', 'api', 'backend', 'services', 'service', 'app', 'backend-service'].includes(baseName)) score += 100;
    else if (['client', 'frontend', 'web', 'ui', 'admin'].includes(baseName)) score += 20;
    else score += 10;

    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) };
    if (deps.supertest || deps.jest) score += 50;
    if (pkg.scripts?.test) score += 15;
    if (fs.existsSync(path.join(dir, 'src')) || fs.existsSync(path.join(dir, 'tests')) || fs.existsSync(path.join(dir, '__tests__'))) score += 10;

    return score;
};

export const resolveProjectRoot = (snapshotRoot) => {
    if (!snapshotRoot || typeof snapshotRoot !== 'string') {
        return snapshotRoot ?? null;
    }

    const resolvedRoot = path.resolve(snapshotRoot);
    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        return resolvedRoot;
    }

    if (hasPackageJson(resolvedRoot)) {
        return resolvedRoot;
    }

    const candidates = [];
    const walk = (dir) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (error) {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (hasPackageJson(fullPath)) {
                candidates.push({ dir: fullPath, score: scorePackageJsonCandidate(fullPath) });
                continue;
            }
            walk(fullPath);
        }
    };

    walk(resolvedRoot);

    if (candidates.length === 0) {
        return resolvedRoot;
    }

    if (candidates.length === 1) {
        return candidates[0].dir;
    }

    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.dir.length - b.dir.length;
    });

    return candidates[0].dir;
};
