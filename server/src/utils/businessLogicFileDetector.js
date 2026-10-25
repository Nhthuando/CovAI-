import fs from "fs";
import path from "path";
import { cleanStoragePath } from "./pathSanitizer.js";

/**
 * Extracts coverage exclusion patterns from test runner config files
 * (vitest.config.*, jest.config.*, package.json).
 *
 * @param {string} rootDir - Project root directory
 * @returns {string[]} Array of normalized exclusion string fragments
 */
export const extractProjectCoverageExclusions = (rootDir = "") => {
    const exclusions = new Set();
    if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
        return Array.from(exclusions);
    }
    const candidateFiles = [
        "vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs",
        "jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs", "jest.config.json",
        "package.json"
    ];
    for (const file of candidateFiles) {
        const full = path.join(rootDir, file);
        if (fs.existsSync(full)) {
            try {
                const content = fs.readFileSync(full, "utf8");
                const excludeMatch = content.match(/coverage\s*:\s*\{[\s\S]*?exclude\s*:\s*\[([\s\S]*?)\]/i) ||
                    content.match(/coveragePathIgnorePatterns\s*:\s*\[([\s\S]*?)\]/i);
                if (excludeMatch && excludeMatch[1]) {
                    const matches = excludeMatch[1].match(/['"`]([^'"`]+)['"`]/g) || [];
                    for (const m of matches) {
                        const raw = m.replace(/['"`]/g, "").replace(/\*\*/g, "").replace(/\*/g, "").replace(/^\.?\//, "").trim();
                        if (raw) exclusions.add(raw.toLowerCase());
                    }
                }
            } catch { }
        }
    }
    return Array.from(exclusions);
};

/**
 * Checks whether a given file path represents a unit, integration, e2e test,
 * spec, mock, fixture, or ad-hoc test runner script.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export const isTestFilePath = (filePath = "") => {
    if (!filePath || typeof filePath !== "string") return false;
    const cleanStorage = cleanStoragePath(filePath);
    const cleanP = (cleanStorage || filePath).replace(/\\/g, "/");
    const norm = cleanP.toLowerCase();
    const rawBase = path.basename(cleanP);

    // 1. Test directory pattern
    if (/(^|\/)(?:tests?|__tests__|specs?|__specs__|e2e|cypress|playwright|step-definitions?|step_definitions|fixtures?|mocks?|__mocks__|test[-_]data|test[-_]utils?|testing|test[-_]helpers?|(?:[a-z0-9_-]+[-_])?tests?)(?:\/|$)/i.test(norm)) {
        return true;
    }
    // 2. Token-separated test file name (e.g. test-api.ts, api-test.ts, test.ts, auth.test.js, test_runner.js)
    if (/(?:^|[._-])(?:tests?|specs?|testcase|steps?)(?:[._-]|$)/i.test(rawBase)) {
        return true;
    }
    // 3. CamelCase / PascalCase test file names (e.g. testApi.ts, apiTest.ts, calculationServiceTest.ts)
    if (/^tests?[A-Z]/.test(rawBase) || /[a-z0-9](?:Tests?|Specs?)\.[a-z0-9]+$/.test(rawBase)) {
        return true;
    }
    return false;
};

/**
 * Checks whether a given file path represents genuine backend/core Business Logic
 * for Unit Test coverage and analysis.
 *
 * Strictly filters out:
 * - Unit and integration test files (*.test.*, *.spec.*, test-*, *-test.*, tests/, __tests__/)
 * - Build artifacts and package manager caches (node_modules/, coverage/, dist/, build/, .next/, .nuxt/, etc.)
 * - Example and demo files (examples/, demo/, samples/)
 * - Build and bundler configurations (*.config.*, tsup.config.*, vite.config.*, etc.)
 * - TypeScript type definition files (*.d.ts, types.ts, *.types.ts, types/)
 * - Frontend and UI components/hooks/i18n (components/, views/, pages/, hooks/, context/, i18n/, etc.)
 * - HTTP routes and top-level entrypoints (routes/, endpoints/, app.js, server.js, index.js, main.js)
 * - Test runner specific coverage exclusions (from jest.config or vitest.config)
 *
 * @param {string} filePath - Absolute or relative file path
 * @param {string[]|Set<string>} configExclusions - Additional excluded paths/patterns from runner config
 * @returns {boolean}
 */
export const isBusinessLogicSourceFile = (filePath = "", configExclusions = []) => {
    if (!filePath || typeof filePath !== "string") return false;
    const cleanStorage = cleanStoragePath(filePath);
    const cleanP = (cleanStorage || filePath).replace(/\\/g, "/");
    const norm = cleanP.toLowerCase();
    const rawBase = path.basename(cleanP);
    const base = rawBase.toLowerCase();

    // 1. Must be JavaScript or TypeScript
    if (!/\.[cm]?[jt]s$/i.test(norm)) return false;

    // 2. Reject TypeScript declaration files
    if (/\.d\.ts$/i.test(norm)) return false;

    // 3. Reject tests, specs, and test directories
    if (isTestFilePath(cleanP)) {
        return false;
    }

    // 4. Reject dependencies, build outputs, and caches
    if (/(^|\/)(node_modules|coverage|dist|build|out|\.next|\.nuxt|\.turbo|\.git|\.cache|\.covai-temp|\.covai_journal)\//i.test(norm)) {
        return false;
    }

    // Reject direct internal server storage paths
    if (/(?:^|\/)storage\/projects\//i.test(norm) || /(?:^|\/)server\/storage\//i.test(norm)) {
        return false;
    }

    // 5. Reject examples, demos, and samples
    if (/(^|\/)(examples?|demos?|samples?)\//i.test(norm)) {
        return false;
    }

    // 6. Reject setup, helper, and config files
    if (
        /^(setup|global-?setup|setup-?tests|teardown|fixtures?)\.[a-z0-9]+$/i.test(base) ||
        /(^|\/|\.)config\.[a-z0-9]+$/i.test(norm) ||
        /\.config\.[a-z0-9]+$/i.test(base) ||
        /(tsup|vite|vitest|webpack|rollup|babel|eslint|prettier|tailwind|postcss)\.config/i.test(norm)
    ) {
        return false;
    }

    // 7. Reject pure type definitions and static preset data catalogs (e.g. presets/tier10-chat.ts)
    if (
        /(^|\/)(types?|interfaces?)\.[cm]?[jt]s$/i.test(norm) ||
        /\.types\.[cm]?[jt]s$/i.test(norm) ||
        /(^|\/)types\//i.test(norm) ||
        /(^|\/)presets\/tier[0-9]+[a-z0-9_-]*\.[cm]?[jt]s$/i.test(norm) ||
        /(^|\/)presets\/(data|catalogs?|fixtures?|definitions?)\//i.test(norm)
    ) {
        return false;
    }

    // 8. Reject frontend UI code, hooks, context, and translations
    if (
        /(^|\/)(client|frontend|components|views|pages|hooks|context|contexts|i18n|locales?|translations?)\//i.test(norm) ||
        /\.[jt]sx$/i.test(norm) ||
        /^use[A-Z]/.test(rawBase)
    ) {
        return false;
    }

    // 9. Reject route and server entry files (reserved for integration/system testing)
    const isTopLevelEntry = /^(?:[a-z0-9_-]+\/)?(?:src\/)?(index|main)\.[cm]?[jt]sx?$/i.test(norm.replace(/^\.?\//, ""));
    const isRouteOrEntry = /(^|\/)(routes?|endpoints?)(\/|\.|$)/i.test(norm) ||
        /\.(route|routes)\.[cm]?[jt]sx?$/i.test(norm) ||
        /(^|\/)(app|server)\.[cm]?[jt]sx?$/i.test(norm) ||
        isTopLevelEntry;
    if (isRouteOrEntry) {
        return false;
    }

    // 10. Reject files explicitly excluded in test runner coverage configurations (e.g. vitest.config.ts exclude)
    if (configExclusions && (Array.isArray(configExclusions) || configExclusions instanceof Set)) {
        for (const exc of configExclusions) {
            if (!exc) continue;
            const normExc = String(exc).replace(/\\/g, "/").toLowerCase().replace(/^\.?\//, "");
            if (norm.endsWith(normExc) || norm.includes(`/${normExc}`)) {
                return false;
            }
        }
    }

    return true;
};
