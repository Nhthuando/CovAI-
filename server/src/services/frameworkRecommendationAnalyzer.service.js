import fs from "fs";
import path from "path";

const FRAMEWORKS = ["jest", "vitest"];
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const IGNORED_DIRECTORIES = new Set([
    "node_modules", ".git", "coverage", "dist", "build", ".next", ".nuxt", ".vite", ".vitest", ".cache", "vendor",
]);
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/i;
const TEST_FILE = /(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/i;
const MAX_SOURCE_FILES = 200;
const MAX_SOURCE_BYTES = 1024 * 1024;

const normalizePath = (value) => value.split(path.sep).join("/");

const readPackageJson = (rootDir, diagnostics) => {
    const packagePath = path.join(rootDir, "package.json");
    if (!fs.existsSync(packagePath)) {
        diagnostics.push("package.json was not found");
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(packagePath, "utf8"));
    } catch {
        diagnostics.push("Unable to parse package.json");
        return {};
    }
};

const scanSourceEvidence = (rootDir, diagnostics) => {
    const evidence = {
        filesScanned: 0,
        bytesScanned: 0,
        paths: [],
        hasClientDirectory: false,
        hasServerDirectory: false,
        hasViteImport: false,
        hasReactImport: false,
        hasVueImport: false,
        hasNextImport: false,
        hasExpressImport: false,
        hasNestImport: false,
        testFiles: { jest: 0, vitest: 0, unknown: 0 },
    };
    const visit = (directory) => {
        if (evidence.filesScanned >= MAX_SOURCE_FILES || evidence.bytesScanned >= MAX_SOURCE_BYTES) return;
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        } catch {
            diagnostics.push(`Unable to read directory: ${normalizePath(path.relative(rootDir, directory) || ".")}`);
            return;
        }
        for (const entry of entries) {
            if (evidence.filesScanned >= MAX_SOURCE_FILES || evidence.bytesScanned >= MAX_SOURCE_BYTES) break;
            const filePath = path.join(directory, entry.name);
            const relativePath = normalizePath(path.relative(rootDir, filePath));
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name)) {
                    if (["client", "frontend", "web"].includes(entry.name)) evidence.hasClientDirectory = true;
                    if (["server", "backend", "api"].includes(entry.name)) evidence.hasServerDirectory = true;
                    visit(filePath);
                }
                continue;
            }
            if (!entry.isFile() || !SOURCE_EXTENSION.test(entry.name)) continue;
            let stat;
            try {
                stat = fs.statSync(filePath);
            } catch {
                diagnostics.push(`Unable to stat source file: ${relativePath}`);
                continue;
            }
            const remaining = MAX_SOURCE_BYTES - evidence.bytesScanned;
            if (stat.size > remaining) continue;
            let content;
            try {
                content = fs.readFileSync(filePath, "utf8");
            } catch {
                diagnostics.push(`Unable to read source file: ${relativePath}`);
                continue;
            }
            evidence.filesScanned += 1;
            evidence.bytesScanned += Buffer.byteLength(content, "utf8");
            evidence.paths.push(relativePath);
            evidence.hasViteImport ||= /(?:from\s+["']vite["']|require\(["']vite["']\))/.test(content);
            evidence.hasReactImport ||= /(?:from\s+["']react["']|require\(["']react["']\))/.test(content);
            evidence.hasVueImport ||= /(?:from\s+["']vue["']|require\(["']vue["']\))/.test(content);
            evidence.hasNextImport ||= /(?:from\s+["']next["']|require\(["']next["']\))/.test(content);
            evidence.hasExpressImport ||= /(?:from\s+["']express["']|require\(["']express["']\))/.test(content);
            evidence.hasNestImport ||= content.includes("@nestjs/");
            if (TEST_FILE.test(entry.name)) {
                if (/@jest\/globals|\bjest\s*\./.test(content)) evidence.testFiles.jest += 1;
                else if (/from\s+["']vitest["']|\bvi\s*\./.test(content)) evidence.testFiles.vitest += 1;
                else evidence.testFiles.unknown += 1;
            }
        }
    };
    if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
        diagnostics.push("Project rootDir does not exist");
        return evidence;
    }
    visit(rootDir);
    return evidence;
};

const collectDependencies = (packageJson) => Object.assign({}, ...DEPENDENCY_SECTIONS.map((section) => packageJson[section] || {}));

const classifyProject = (packageJson, source) => {
    const dependencies = collectDependencies(packageJson);
    const hasFrontend = Boolean(
        dependencies.vite || dependencies.react || dependencies["react-dom"] || dependencies.vue || dependencies.next ||
        source.hasClientDirectory || source.hasViteImport || source.hasReactImport || source.hasVueImport || source.hasNextImport,
    );
    const hasBackend = Boolean(
        dependencies.express || dependencies.fastify || dependencies["@nestjs/core"] || dependencies.koa ||
        source.hasServerDirectory || source.hasExpressImport || source.hasNestImport,
    );
    if (hasFrontend && hasBackend) return "fullstack";
    if (hasFrontend) return "frontend";
    if (hasBackend) return "backend";
    if (packageJson.main || packageJson.module || packageJson.exports || packageJson.types) return "library";
    return "unknown";
};

const frameworkConfigPaths = (rootDir, framework) => {
    const names = framework === "jest"
        ? ["jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts"]
        : ["vitest.config.js", "vitest.config.cjs", "vitest.config.mjs", "vitest.config.ts"];
    return names.filter((name) => fs.existsSync(path.join(rootDir, name)));
};

const addEvidence = (candidate, code, weight, message, source) => {
    candidate.score += weight;
    candidate.evidence.push({ code, weight, message, source });
};

const scoreFramework = ({ framework, rootDir, packageJson, source, projectType }) => {
    const dependencies = collectDependencies(packageJson);
    const scripts = Object.entries(packageJson.scripts || {}).filter(([, command]) =>
        typeof command === "string" && new RegExp(`\\b${framework}\\b`, "i").test(command),
    );
    const configPaths = frameworkConfigPaths(rootDir, framework);
    const installed = Boolean(dependencies[framework]);
    const candidate = {
        framework,
        score: 0,
        detected: Boolean(installed || scripts.length || configPaths.length || source.testFiles[framework]),
        installed,
        requiresInstallation: !installed,
        evidence: [],
    };
    if (installed) addEvidence(candidate, "dependency", 35, `Existing ${framework} dependency is declared.`, "package.json");
    if (scripts.length) addEvidence(candidate, "script", 25, `Existing script uses ${framework}: ${scripts[0][0]}.`, "package.json");
    if (configPaths.length) addEvidence(candidate, "config", 20, `Existing ${framework} configuration was found.`, configPaths[0]);
    const testCount = source.testFiles[framework];
    if (testCount) addEvidence(candidate, "existing-tests", Math.min(testCount * 10, 30), `${testCount} existing ${framework} test file${testCount === 1 ? "" : "s"} were found.`, "source");
    if (framework === "vitest" && projectType === "frontend") addEvidence(candidate, "project-compatibility", 16, "Vitest is well suited to this frontend project.", "project-type");
    if (framework === "vitest" && (dependencies.vite || source.hasViteImport)) addEvidence(candidate, "vite-compatibility", 9, "Vite evidence favors Vitest compatibility.", "source");
    if (framework === "jest" && projectType === "backend") addEvidence(candidate, "project-compatibility", 14, "Jest is well suited to this Node/backend project.", "project-type");
    if (framework === "jest" && projectType === "library") addEvidence(candidate, "project-compatibility", 6, "Jest is a conservative default for this library project.", "project-type");
    return candidate;
};

const selectCandidate = (candidates, source) => [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (source.testFiles[right.framework] !== source.testFiles[left.framework]) {
        return source.testFiles[right.framework] - source.testFiles[left.framework];
    }
    return left.framework === "jest" ? -1 : 1;
})[0];

export const analyzeFrameworkRecommendation = (rootDir) => {
    const diagnostics = [];
    const packageJson = readPackageJson(rootDir, diagnostics);
    const source = scanSourceEvidence(rootDir, diagnostics);
    const projectType = classifyProject(packageJson, source);
    const candidates = FRAMEWORKS.map((framework) => scoreFramework({ framework, rootDir, packageJson, source, projectType }));
    const recommended = selectCandidate(candidates, source);
    const explanation = recommended.evidence.length
        ? recommended.evidence.map((item) => item.message)
        : [`No explicit test framework evidence was found; ${recommended.framework} is the deterministic default.`];
    return {
        version: 1,
        projectType,
        recommendedFramework: recommended.framework,
        candidates,
        explanation,
        diagnostics,
        scan: { filesScanned: source.filesScanned, bytesScanned: source.bytesScanned, maxFiles: MAX_SOURCE_FILES, maxBytes: MAX_SOURCE_BYTES },
    };
};
