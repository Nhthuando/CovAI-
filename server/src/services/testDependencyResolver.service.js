import fs from "fs";
import path from "path";
import { unitTestInventory } from './unitTestFilePolicy.service.js';

/**
 * In-memory cache for test dependency maps keyed by rootDir.
 * Stores { timestamp, testMap, testFiles }
 */
const dependencyCache = new Map();
const DEPENDENCY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Explicit cache invalidator called when test files are added, modified, or tests finish.
 */
export const invalidateDependencyCache = (rootDir = null) => {
    if (rootDir) {
        dependencyCache.delete(rootDir);
    } else {
        dependencyCache.clear();
    }
};

/**
 * Normalizes file path to forward slashes with no leading slash or dot.
 */
export const normalizePath = (p = "") => {
    return p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
};

/**
 * Removes file extension for loose module matching.
 * e.g., "src/handlers/create-account.handler.ts" -> "src/handlers/create-account.handler"
 */
export const stripExtension = (p = "") => {
    return p.replace(/\.[cm]?[jt]sx?$/i, "");
};

/**
 * Extracts all import/require/mock specifiers from a test file's code.
 * Uses robust regular expressions capable of capturing:
 * - ES6 Static Imports: import ... from '...'
 * - ES6 Dynamic Imports: import('...')
 * - CommonJS: require('...')
 * - Jest Mocks: jest.mock('...'), jest.unstable_mockModule('...')
 *
 * @param {string} content
 * @returns {Array<string>} list of specifiers
 */
export const extractModuleSpecifiers = (content = "") => {
    if (!content || typeof content !== "string") return [];

    const specifiers = new Set();
    const mockedSpecifiers = new Set();

    // 0. Collect mocked module specifiers: jest.mock('...'), jest.unstable_mockModule('...'), vi.mock('...')
    // Mocked modules are dependencies of the SUT, not the SUT itself.
    const mockCallRegex = /\b(?:jest|vi)\.(?:mock|unstable_mockModule|doMock)\s*\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = mockCallRegex.exec(content)) !== null) {
        if (m[1]) mockedSpecifiers.add(m[1].trim());
    }

    // 1. Static imports: import ... from 'specifier' or import 'specifier'
    const staticImportRegex = /(?:^|\n|\r)\s*(?:import\s+(?:[\w*\s{},$]+\s+from\s+)?|export\s+(?:[\w*\s{},$]+\s+from\s+)?)['"]([^'"]+)['"]/g;
    while ((m = staticImportRegex.exec(content)) !== null) {
        const spec = m[1]?.trim();
        if (spec && !mockedSpecifiers.has(spec)) specifiers.add(spec);
    }

    // 2. Dynamic imports & requires: import('specifier'), require('specifier')
    const dynamicRegex = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dynamicRegex.exec(content)) !== null) {
        const spec = m[1]?.trim();
        if (spec && !mockedSpecifiers.has(spec)) specifiers.add(spec);
    }

    // 3. Explicit requireActual / importActual calls
    const jestActualRegex = /\b(?:jest|vi)\.(?:requireActual|importActual)\s*\(\s*['"]([^'"]+)['"]/g;
    while ((m = jestActualRegex.exec(content)) !== null) {
        const spec = m[1]?.trim();
        if (spec) specifiers.add(spec);
    }

    return Array.from(specifiers);
};

/**
 * Scans all test files in the project directory.
 *
 * @param {string} rootDir
 * @returns {Array<string>} list of relative paths of test files
 */
export const discoverAllTestFiles = (rootDir) => {
    if (!rootDir || !fs.existsSync(rootDir)) return [];
    return unitTestInventory(rootDir).tests.map(test => test.filePath);
};

/**
 * Resolves a module specifier from a test file to a project-relative source path.
 *
 * @param {string} rootDir
 * @param {string} testRelativePath - e.g. "tests/unit/handlers/create-account.handlers.test.ts"
 * @param {string} specifier - e.g. "../../../src/handlers/create-quickbooks-account.handler"
 * @returns {string|null} - e.g. "src/handlers/create-quickbooks-account.handler"
 */
export const resolveSpecifierToRelativePath = (rootDir, testRelativePath, specifier) => {
    if (!specifier || typeof specifier !== "string") return null;

    // Ignore external node_modules packages (e.g. "@jest/globals", "express", "lodash", "react")
    if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("@/") && !specifier.startsWith("~/")) {
        // If it starts with "src/", treat as root-relative
        if (specifier.startsWith("src/")) {
            return normalizePath(specifier);
        }
        return null;
    }

    // Handle aliases like "@/..." or "~/..." pointing to "src/..."
    if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
        return normalizePath("src/" + specifier.slice(2));
    }

    // Relative path from test file's directory
    const testDir = path.dirname(path.join(rootDir, testRelativePath));
    const targetAbs = path.resolve(testDir, specifier);
    const relFromRoot = path.relative(rootDir, targetAbs);

    if (relFromRoot.startsWith("..")) {
        // Outside project root
        return null;
    }

    return normalizePath(relFromRoot);
};

/**
 * Counts total test cases (it / test blocks) in a test file content.
 */
export const countTestCases = (content = "") => {
    if (!content) return 0;
    const matches = content.match(/\b(?:it|test)\s*\(\s*['"`]/g);
    return matches ? matches.length : 0;
};

/**
 * Builds an inverted dependency map:
 * sourceNoExt -> Array<LinkedTestFileInfo>
 *
 * @param {string} rootDir
 * @param {boolean} [forceRefresh=false]
 * @returns {Map<string, Array<Object>>}
 */
export const buildProjectTestDependencyMap = (rootDir, forceRefresh = false) => {
    if (!rootDir) {
        return new Map();
    }

    const cached = dependencyCache.get(rootDir);
    const now = Date.now();
    if (!forceRefresh && cached && (process.env.NODE_ENV === "test" || now - cached.timestamp < DEPENDENCY_CACHE_TTL_MS)) {
        return cached.testMap;
    }
    const inventory = fs.existsSync(rootDir) ? unitTestInventory(rootDir) : null;
    if (!forceRefresh && cached && cached.identity === inventory?.identity) {
        cached.timestamp = now;
        return cached.testMap;
    }

    if (!fs.existsSync(rootDir)) {
        return new Map();
    }

    const testFiles = inventory.tests.map(file => file.filePath);
    const testMap = new Map(); // sourceNoExt -> Array<TestFileInfo>

    for (const test of inventory.tests) {
        const testRel = test.filePath;
        const content = test.content;

        const specifiers = extractModuleSpecifiers(content);
        const testCount = countTestCases(content);
        const framework = test.framework;

        for (const spec of specifiers) {
            const resolvedRel = resolveSpecifierToRelativePath(rootDir, testRel, spec);
            if (!resolvedRel) continue;

            // Strip extension for matching
            const keyNoExt = stripExtension(resolvedRel);

            if (!testMap.has(keyNoExt)) {
                testMap.set(keyNoExt, []);
            }

            const existingList = testMap.get(keyNoExt);
            // Avoid duplicate entries for the same test file
            if (!existingList.some(item => item.filePath === testRel)) {
                existingList.push({
                    filePath: testRel,
                    fileName: path.basename(testRel),
                    relationType: "DIRECT_IMPORT",
                    confidence: 1.0,
                    specifier: spec,
                    testCode: content,
                    testCount,
                    framework
                });
            }
        }
    }

    dependencyCache.set(rootDir, {
        timestamp: now,
        identity: inventory.identity,
        testMap,
        testFiles
    });
    while (dependencyCache.size > 12) dependencyCache.delete(dependencyCache.keys().next().value);

    return testMap;
};

/**
 * Finds all test files that import or touch a target source file.
 *
 * @param {string} rootDir
 * @param {string} targetSourcePath - e.g. "src/handlers/create-quickbooks-account.handler.ts"
 * @returns {Array<Object>} list of linked test files
 */
export const findTestsImportingSource = (rootDir, targetSourcePath) => {
    if (!rootDir || !targetSourcePath) return [];

    const normSource = normalizePath(targetSourcePath);
    const sourceNoExt = stripExtension(normSource);

    const testMap = buildProjectTestDependencyMap(rootDir);

    // 1. Direct match on stripped path
    const directMatches = testMap.get(sourceNoExt) || [];
    if (directMatches.length > 0) {
        return directMatches;
    }

    // 2. Loose match (e.g. if targetSourcePath has a leading 'src/' or lacks it)
    for (const [key, tests] of testMap.entries()) {
        if (key === sourceNoExt || key.endsWith("/" + sourceNoExt) || sourceNoExt.endsWith("/" + key)) {
            return tests;
        }
        // Also check if base names match and directory matches
        if (path.basename(key) === path.basename(sourceNoExt)) {
            return tests;
        }
    }

    return [];
};
