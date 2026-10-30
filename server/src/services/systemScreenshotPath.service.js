import fs from 'node:fs';
import { containedPath, resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';

export const resolveSystemScreenshot = (rootDir, screenshotPath) => {
    if (!screenshotPath?.startsWith('.covai-system-test/evidence/')) return null;
    // Older runner evidence can be package-relative; measured runs use the repo.
    // Both locations must stay within the owned snapshot's recognized repository.
    const original = containedPath(rootDir,screenshotPath);
    if (fs.existsSync(original)) return original;
    const repository = resolveSystemRepositoryRoot(rootDir);
    if (repository === rootDir) return null;
    const canonical = containedPath(repository,screenshotPath);
    return fs.existsSync(canonical) ? canonical : null;
};
