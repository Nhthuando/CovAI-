import fs from 'fs';
import path from 'path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist', 'build', '.next', '.turbo', 'storage']);

const isDirectory = (p) => {
    try {
        if (!fs.existsSync(p)) return false;
        if (typeof fs.statSync === 'function') {
            return fs.statSync(p).isDirectory();
        }
        return true;
    } catch {
        return false;
    }
};

const isFile = (p) => {
    try {
        if (!fs.existsSync(p)) return false;
        if (typeof fs.statSync === 'function') {
            return fs.statSync(p).isFile();
        }
        return true;
    } catch {
        return false;
    }
};

const hasPackageJson = (dir) => {
    const packageJsonPath = path.join(dir, 'package.json');
    return isFile(packageJsonPath);
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

/**
 * Resolves a snapshot's root directory, translating Docker container paths (/app/storage/... or /app/uploads/...)
 * to local host paths on the current operating system (Windows/Linux/macOS), while verifying that the
 * directory actually contains package.json, source code, or tests.
 *
 * @param {string} snapshotRoot - The stored rootDir (may be /app/storage/..., Windows path, etc.)
 * @returns {string} The verified host directory path
 */
export const resolveSnapshotRootDir = (snapshotRoot) => {
    if (!snapshotRoot || typeof snapshotRoot !== 'string' || !snapshotRoot.trim()) {
        return null;
    }

    const hasCodeOrConfig = (dir) => {
        try {
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
            return fs.existsSync(path.join(dir, 'package.json')) ||
                fs.existsSync(path.join(dir, 'src')) ||
                fs.existsSync(path.join(dir, 'tests')) ||
                fs.existsSync(path.join(dir, '__tests__'));
        } catch {
            return false;
        }
    };

    // Strip any Windows drive letter prefix (e.g. D:\, C:/) on non-Windows platforms
    const normalized = snapshotRoot.replace(/\\/g, '/');
    const strippedDrive = normalized.replace(/^[a-zA-Z]:(?:\/|$)/, '/');

    // Determine current server root directory and potential base roots
    const serverRoot = process.cwd();
    let fileServerDir = serverRoot;
    try {
        if (typeof __dirname !== 'undefined') {
            fileServerDir = path.resolve(__dirname, '../..');
        }
    } catch (_) {}
    const baseCandidates = [serverRoot, path.resolve(serverRoot, 'server'), fileServerDir];

    // On non-Windows platforms, always work with strippedDrive
    const cleanRoot = process.platform !== 'win32' ? strippedDrive : snapshotRoot;

    // Try resolving as standard local path if it exists
    if (process.platform === 'win32' && (cleanRoot.startsWith('/') || cleanRoot.startsWith('\\'))) {
        // Prevent path.resolve('/app/...') from attaching D:\app on Windows
        const withoutRoot = strippedDrive.replace(/^\/+/, '');
        for (const base of baseCandidates) {
            const cand = path.resolve(base, withoutRoot);
            if (hasCodeOrConfig(cand) || fs.existsSync(cand)) return cand;
        }
    } else {
        const resolved = path.resolve(cleanRoot);
        if (hasCodeOrConfig(resolved) || fs.existsSync(resolved)) {
            return resolved;
        }
    }

    // Check if snapshotRoot is a Docker container path (/app/storage/... or /app/uploads/...)
    if (strippedDrive.startsWith('/app/') || strippedDrive.startsWith('app/')) {
        const sub = strippedDrive.replace(/^\/?app\//, '');
        for (const base of baseCandidates) {
            const candidate = path.resolve(base, sub);
            if (hasCodeOrConfig(candidate) || fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    // Check if snapshotRoot contains 'storage' or 'uploads'
    for (const marker of ['storage', 'uploads']) {
        const idx = strippedDrive.indexOf(marker);
        if (idx !== -1) {
            const sub = strippedDrive.slice(idx);
            for (const base of baseCandidates) {
                const candidate = path.resolve(base, sub);
                if (hasCodeOrConfig(candidate) || fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
    }

    if (process.platform !== 'win32') {
        return path.resolve(strippedDrive);
    }
    const clean = strippedDrive.replace(/^\/+/, '');
    return path.resolve(fileServerDir, clean);
};

export const resolveProjectRoot = (snapshotRoot) => {
    if (!snapshotRoot || typeof snapshotRoot !== 'string') {
        return snapshotRoot ?? null;
    }

    const hostRoot = resolveSnapshotRootDir(snapshotRoot);
    const resolvedRoot = path.resolve(hostRoot);
    if (!isDirectory(resolvedRoot)) {
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

export const hasSourceCodeFiles = (dir) => {
    if (!dir || typeof dir !== 'string') return false;
    const resolved = path.resolve(dir);
    if (!isDirectory(resolved)) return false;

    const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
    let found = false;

    const walk = (current) => {
        if (found) return;
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (found) return;
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) {
                    walk(path.join(current, entry.name));
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (SOURCE_EXTS.has(ext)) {
                    found = true;
                    return;
                }
            }
        }
    };

    walk(resolved);
    return found;
};

export const ensureMinimalPackageJson = (dir) => {
    if (!dir || typeof dir !== 'string') return null;
    const resolved = path.resolve(dir);
    if (!isDirectory(resolved)) return null;

    const packageJsonPath = path.join(resolved, 'package.json');
    if (isFile(packageJsonPath)) {
        return packageJsonPath;
    }

    const baseName = path.basename(resolved).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'project';
    const minimal = {
        name: baseName,
        version: '1.0.0',
        type: 'module',
        scripts: {
            test: 'jest'
        },
        devDependencies: {
            jest: '^29.7.0'
        }
    };

    try {
        fs.writeFileSync(packageJsonPath, JSON.stringify(minimal, null, 2), 'utf8');
        return packageJsonPath;
    } catch (e) {
        console.error(`[ensureMinimalPackageJson] Failed to write minimal package.json at ${packageJsonPath}:`, e.message);
        return null;
    }
};
