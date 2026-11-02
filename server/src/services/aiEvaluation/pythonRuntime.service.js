import fs from 'node:fs/promises';
import path from 'node:path';
import { fail, hash } from './common.js';

/** Controlled Python images only; never accepts a repository-supplied Docker image. */
export async function selectPythonRuntime(root, directory = '.') {
    const read = file => fs.readFile(path.join(root, directory, file), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const requirements = await read('requirements.txt');
    let version = '3.12', declaredFile = null;
    for (const file of ['.python-version', 'runtime.txt']) {
        const content = (await read(file)).trim();
        if (!content) continue;
        const match = /^(?:python-)?(3\.(?:10|11|12)(?:\.\d{1,2})?)$/.exec(content);
        if (!match) fail('PYTHON_RUNTIME_UNSUPPORTED', `File ${file} specifies a Python version not supported by sandbox (supports 3.10, 3.11, 3.12).`);
        version = match[1]; declaredFile = file; break;
    }
    // These pinned releases have CPython 3.11 wheels, but no CPython 3.12 wheels.
    // Keep the project's package pins intact; do not silently upgrade its dependencies.
    const legacyPins = [...requirements.matchAll(/^\s*(numpy|torch)\s*==\s*(\d+)\.(\d+)\.(\d+)(?:\s|$|;)/gmi)].filter(([, name, major, minor]) => name.toLowerCase() === 'numpy' ? Number(major) === 1 && [24, 25].includes(Number(minor)) : Number(major) === 2 && [0, 1].includes(Number(minor))).map(match => `${match[1].toLowerCase()}==${match[2]}.${match[3]}.${match[4]}`);
    if (legacyPins.length && Number(version.split('.')[1]) > 11) {
        if (declaredFile) fail('PYTHON_RUNTIME_CONFLICT', `${declaredFile} requires Python ${version}, but pinned packages ${legacyPins.join(', ')} require Python runtime prior to 3.12.`);
        version = '3.11';
    }
    return { version, basis: declaredFile ? 'PROJECT_DECLARATION' : legacyPins.length ? 'PINNED_WHEEL_COMPATIBILITY' : 'COVAI_DEFAULT', declaredFile, compatibilityPins: legacyPins, requirementsHash: requirements ? hash(requirements) : null };
}

/** Return useful categories without exposing raw pip/npm output, URLs or credentials. */
export function sandboxStartupFailure(stage, error, pythonRuntime) {
    const detail = String(error.diagnostic || '');
    if (stage === 'INSTALLING_DEPENDENCIES') {
        if (error.code === 'SANDBOX_COMMAND_TIMEOUT') return { code: 'DEPENDENCY_INSTALL_TIMEOUT', message: 'Dependency installation timed out. Large ML projects require pre-warmed runtime/dependency cache; will not automatically retry chatbot requests.' };
        const match = /No matching distribution found for\s+([A-Za-z0-9_.-]+(?:==[A-Za-z0-9_.+-]+)?)/.exec(detail);
        if (match) return { code: 'DEPENDENCY_VERSION_UNAVAILABLE', message: `Cannot find package ${match[1]} for Python ${pythonRuntime?.version || 'selected'}. Check project Python version and requirements.txt.` };
        if (/No space left on device|ENOSPC|Errno 28/.test(detail)) return { code: 'SANDBOX_STORAGE_LIMIT', message: 'Dependencies exceed sandbox storage capacity. ML projects require dedicated runtime/model cache with sufficient storage.' };
        if (/ResolutionImpossible|conflicting dependencies|ERESOLVE/.test(detail)) return { code: 'DEPENDENCY_CONFLICT', message: 'Project dependencies have conflicting version resolutions. Consistent requirements/lockfile required; COVAI does not alter dependency versions.' };
        return { code: 'DEPENDENCY_INSTALL_FAILED', message: 'Failed to install dependencies in sandbox. Verify manifest, package registry, native dependencies, and resource limits.' };
    }
    return { code: 'SANDBOX_START_FAILED', message: `Failed to prepare sandbox at step ${stage}. Verify Docker, runtime environment, and start commands.` };
}
