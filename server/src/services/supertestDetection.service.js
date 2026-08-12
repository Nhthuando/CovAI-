import fs from 'fs';
import path from 'path';

/**
 * Detects Supertest usage in a project directory.
 */
export const detectSupertest = async (rootDir) => {
    const pkgPath = path.join(rootDir, 'package.json');
    let detected = false;
    let version = null;
    const detectionReasons = [];

    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
            if (deps.supertest) {
                detected = true;
                version = deps.supertest;
                detectionReasons.push('Supertest dependency found in package.json');
            } else {
                detectionReasons.push('Supertest dependency not found');
            }
        } catch (e) {
            detectionReasons.push(`Error reading package.json: ${e.message}`);
        }
    } else {
        detectionReasons.push('package.json not found');
    }

    const testFiles = [];
    const supertestFiles = [];

    // Simple recursive file scanner for test files
    const scanDir = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                if (file !== 'node_modules' && file !== 'storage') {
                    scanDir(fullPath);
                }
            } else if (/\.(test|spec)\.(js|ts)$/.test(file)) {
                testFiles.push(fullPath);
                const content = fs.readFileSync(fullPath, 'utf8');
                if (content.includes('supertest') || content.includes('request(')) {
                    supertestFiles.push(fullPath);
                }
            }
        }
    };

    if (fs.existsSync(rootDir)) {
        scanDir(rootDir);
    }

    return {
        detected: detected || supertestFiles.length > 0,
        version,
        framework: 'jest',
        testFiles,
        supertestFiles,
        configFile: fs.existsSync(path.join(rootDir, 'jest.config.js')) ? 'jest.config.js' : null,
        testCommand: 'npm test',
        detectionReasons
    };
};