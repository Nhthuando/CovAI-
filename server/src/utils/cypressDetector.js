import fs from "fs";
import path from "path";

const IGNORED_DIRS = [
    "node_modules",
    ".git",
    "coverage",
    "dist",
    "build",
    ".next",
    ".vite",
    ".vitest",
    "storage",
    "uploads",
];

export function detectCypress(rootDir) {
    const pkgPath = path.join(rootDir, "package.json");
    let pkg = null;
    let version = null;
    let detected = false;

    if (fs.existsSync(pkgPath)) {
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const cypressKey = Object.keys(deps).find(k => k === "cypress" || k.startsWith("@cypress/"));
            if (cypressKey) {
                detected = true;
                version = deps[cypressKey];
            }
        } catch (e) {
            // Ignore invalid JSON
        }
    }

    const config = findCypressConfig(rootDir);
    const testFiles = findCypressTestFiles(rootDir);
    const testDirectory = testFiles.length > 0 ? findCommonTestDir(testFiles, rootDir) : null;

    return {
        detected: detected || !!config || testFiles.length > 0,
        framework: "CYPRESS",
        type: "SYSTEM",
        version,
        configPath: config ? path.relative(rootDir, config) : null,
        testDirectory: testDirectory ? path.relative(rootDir, testDirectory) : null,
        testFiles: testFiles.map(f => path.relative(rootDir, f)),
    };
}

function findCypressConfig(dir) {
    const names = ["cypress.config.js", "cypress.config.ts", "cypress.config.mjs", "cypress.config.cjs"];
    for (const name of names) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function findCypressTestFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const p = path.join(dir, file);
        if (IGNORED_DIRS.includes(file)) continue;
        if (fs.lstatSync(p).isDirectory()) {
            findCypressTestFiles(p, fileList);
        } else if (/\.cy\.(js|jsx|ts|tsx)$/.test(file)) {
            fileList.push(p);
        }
    }
    return fileList;
}

function findCommonTestDir(files, rootDir) {
    if (files.length === 0) return null;
    const dirs = files.map(f => path.dirname(f));
    // Prefer cypress/e2e or cypress/component
    const preferred = dirs.find(d => d.includes("cypress/e2e") || d.includes("cypress/component"));
    if (preferred) return preferred;
    // Return the most common parent directory
    return dirs[0];
}