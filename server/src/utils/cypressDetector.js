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
    const pkgCandidates = [
        path.join(rootDir, "package.json"),
        path.join(rootDir, "client", "package.json"),
        path.join(rootDir, "frontend", "package.json"),
        path.join(rootDir, "web", "package.json"),
    ];

    let pkg = null;
    let version = null;
    let detected = false;
    let cypressCommand = null;

    for (const pkgPath of pkgCandidates) {
        if (fs.existsSync(pkgPath)) {
            try {
                pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                const cypressKey = Object.keys(deps).find(k => k === "cypress" || k.startsWith("@cypress/"));
                if (cypressKey) {
                    detected = true;
                    version = deps[cypressKey];
                }
                const scripts = pkg.scripts || {};
                if (scripts["test:e2e:cypress"]) {
                    cypressCommand = `npm run --silent test:e2e:cypress`;
                } else if (scripts["test:e2e"] && /cypress/i.test(scripts["test:e2e"])) {
                    cypressCommand = `npm run --silent test:e2e`;
                }
                if (detected) break;
            } catch (e) {
                // Ignore invalid JSON
            }
        }
    }

    const config = findCypressConfig(rootDir);
    const testFiles = findCypressTestFiles(rootDir);
    const testDirectory = testFiles.length > 0 ? findCommonTestDir(testFiles, rootDir) : null;

    if (!cypressCommand && (detected || !!config)) {
        cypressCommand = "npx cypress run";
    }

    return {
        detected: detected || !!config || testFiles.length > 0,
        framework: "CYPRESS",
        type: "SYSTEM",
        version,
        packageVersion: version,
        command: cypressCommand,
        cypressCommand,
        configPath: config ? path.relative(rootDir, config).replace(/\\/g, "/") : null,
        testDirectory: testDirectory ? path.relative(rootDir, testDirectory).replace(/\\/g, "/") : null,
        testFiles: testFiles.map(f => path.relative(rootDir, f).replace(/\\/g, "/")),
    };
}

function findCypressConfig(dir) {
    const names = [
        "cypress.config.js",
        "cypress.config.ts",
        "cypress.config.mjs",
        "cypress.config.cjs",
        path.join("client", "cypress.config.js"),
        path.join("client", "cypress.config.ts"),
    ];
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
        } else if (
            /\.cy\.(js|jsx|ts|tsx)$/.test(file) ||
            (/(?:cypress[\/\\](?:e2e|component|integration))/.test(p) && /\.(spec|test|cy)\.(js|jsx|ts|tsx)$/.test(file))
        ) {
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