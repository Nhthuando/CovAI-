import path from "node:path";
import { detectProjectTechnologies } from "./projectTechnologyDetector.service.js";
import { analyzeDataAccessContracts } from "./dataAccessContractAnalyzer.service.js";
import { extractAssertionPropertyRequirements } from "./mockValidation.service.js";
import { prismaAdapter } from "./mockAdapters/prisma.adapter.js";
import { mongooseAdapter } from "./mockAdapters/mongoose.adapter.js";
import { sequelizeAdapter } from "./mockAdapters/sequelize.adapter.js";
import { typeormAdapter } from "./mockAdapters/typeorm.adapter.js";
import { genericRepositoryAdapter } from "./mockAdapters/genericRepository.adapter.js";
import { inferMockValue } from "./environmentDetection.service.js";

const adapterRegistry = new Map();

/**
 * Registers a mock adapter in the universal mock engine.
 * @param {object} adapter
 */
export function registerMockAdapter(adapter) {
    if (!adapter || typeof adapter.name !== "string" || typeof adapter.canHandle !== "function" || typeof adapter.generateMock !== "function") {
        throw new Error("Invalid mock adapter: must define name, canHandle(), and generateMock()");
    }
    adapterRegistry.set(adapter.name, adapter);
}

export function unregisterMockAdapter(name) {
    return adapterRegistry.delete(name);
}

export function listMockAdapters() {
    return Array.from(adapterRegistry.values()).sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

// Register built-in adapters
registerMockAdapter(prismaAdapter);
registerMockAdapter(mongooseAdapter);
registerMockAdapter(sequelizeAdapter);
registerMockAdapter(typeormAdapter);
registerMockAdapter(genericRepositoryAdapter);

/**
 * Selects the highest-priority registered adapter capable of handling a dependency.
 */
export function selectAdapter({ dependency, contracts = [], technologyReport }) {
    for (const adapter of listMockAdapters()) {
        try {
            if (adapter.canHandle({ dependency, contracts, technologyReport })) {
                return adapter;
            }
        } catch {
            // Skip failing adapter predicate
        }
    }
    return null;
}

function buildEnvIsolationCode(envVars = [], framework = "jest") {
    if (!envVars.length) return "";
    const unique = [...new Set(envVars)].filter((v) => !["NODE_ENV", "PATH", "HOME", "USER"].includes(v));
    if (!unique.length) return "";

    if (framework === "vitest") {
        return (
            `beforeEach(() => {\n` +
            `  vi.clearAllMocks();\n` +
            `  vi.stubEnv('NODE_ENV', 'test');\n` +
            unique.map((v) => `  vi.stubEnv('${v}', process.env.${v} || '${inferMockValue(v)}');`).join("\n") +
            `\n});\n` +
            `afterEach(() => {\n` +
            `  vi.unstubAllEnvs();\n` +
            `});`
        );
    }

    return (
        `const _originalEnv = process.env;\n` +
        `beforeEach(() => {\n` +
        `  jest.clearAllMocks();\n` +
        `  process.env = {\n` +
        `    ..._originalEnv,\n` +
        `    NODE_ENV: 'test',\n` +
        unique.map((v) => `    ${v}: process.env.${v} || '${inferMockValue(v)}',`).join("\n") +
        `\n  };\n` +
        `});\n` +
        `afterEach(() => {\n` +
        `  process.env = _originalEnv;\n` +
        `});`
    );
}

function buildTestIsolationResetCode(framework = "jest") {
    return framework === "vitest"
        ? `beforeEach(() => {\n  vi.clearAllMocks();\n});`
        : `beforeEach(() => {\n  jest.clearAllMocks();\n});`;
}

/**
 * Orchestrates technology detection, data-access contract analysis, adapter
 * selection, mock & fixture generation, and per-test isolation.
 *
 * @param {object} params
 * @returns {object} Universal mock generation result
 */
export function generateUniversalMocks({
    rootDir = "",
    sourceCode = "",
    sourceFile = "",
    existingTestCode = "",
    targetTestFile = "",
    framework = "",
    packageJson = null,
    prismaSchemaContent = null,
} = {}) {
    const technologyReport = detectProjectTechnologies({
        rootDir,
        sourceCode,
        sourceFile,
        existingTestCode,
        packageJson,
        preferredFramework: framework || "jest",
    });

    const resolvedFramework = framework || technologyReport.framework || "jest";
    const contractReport = analyzeDataAccessContracts({
        sourceCode,
        sourceFile,
        prismaSchemaPath: technologyReport.schemaFiles?.prismaSchemaPath || null,
        prismaSchemaContent,
    });

    const mockBlocks = [];
    const adapterSelections = [];
    const unsupportedDependencies = [];
    const diagnostics = [];

    const assertionFields = existingTestCode ? extractAssertionPropertyRequirements(existingTestCode) : [];

    for (const dependency of contractReport.dependencies) {
        const depContracts = contractReport.contracts.filter((c) => c.importSource === dependency.source);
        // Rewrite relative specifier from sourceFile-relative to targetTestFile-relative when both are known
        let effectiveSource = dependency.source;
        if (effectiveSource.startsWith(".") && sourceFile && targetTestFile) {
            const absBase = rootDir || process.cwd();
            const absSourceFile = path.isAbsolute(sourceFile) ? sourceFile : path.resolve(absBase, sourceFile);
            const absTargetTest = path.isAbsolute(targetTestFile) ? targetTestFile : path.resolve(absBase, targetTestFile);
            const absResolvedDep = path.resolve(path.dirname(absSourceFile), effectiveSource);
            let relFromTest = path.relative(path.dirname(absTargetTest), absResolvedDep).replaceAll("\\", "/");
            if (!relFromTest.startsWith(".")) relFromTest = `./${relFromTest}`;
            effectiveSource = relFromTest;
        }
        const effectiveDependency = effectiveSource !== dependency.source
            ? { ...dependency, source: effectiveSource }
            : dependency;

        const adapter = selectAdapter({
            dependency: effectiveDependency,
            contracts: depContracts,
            technologyReport,
        });

        if (!adapter) {
            unsupportedDependencies.push({
                source: effectiveDependency.source,
                reason: "NO_MATCHING_ADAPTER",
            });
            diagnostics.push({
                severity: "warning",
                rule: "UNSUPPORTED_DEPENDENCY",
                message: `No mock adapter matched dependency '${effectiveDependency.source}'.`,
            });
            continue;
        }

        const generated = adapter.generateMock({
            dependency: effectiveDependency,
            contracts: depContracts,
            framework: resolvedFramework,
            targetTestFile,
            sourceFile,
            rootDir,
            schemaModels: contractReport.schemaModels,
            assertionFields,
        });

        if (generated.status === "UNSUPPORTED_DEPENDENCY") {
            unsupportedDependencies.push({
                source: effectiveDependency.source,
                reason: "UNANALYZABLE_DEPENDENCY",
            });
            diagnostics.push(...(generated.diagnostics || []));
            continue;
        }

        if (generated.mockCode) {
            mockBlocks.push(generated.mockCode);
        }
        adapterSelections.push({
            source: effectiveDependency.source,
            adapter: generated.adapter || adapter.name,
            contractsCount: depContracts.length,
            fixtures: generated.fixtures || {},
        });
        diagnostics.push(...(generated.diagnostics || []));
    }

    const envIsolation = buildEnvIsolationCode(technologyReport.envVariables, resolvedFramework);
    const isolationCode = envIsolation || (mockBlocks.length > 0 ? buildTestIsolationResetCode(resolvedFramework) : "");

    const combinedParts = [...mockBlocks];
    if (isolationCode) combinedParts.push(isolationCode);

    return {
        framework: resolvedFramework,
        technologyReport,
        contractReport,
        mockCode: combinedParts.join("\n\n"),
        isolationCode,
        adapterSelections,
        unsupportedDependencies,
        diagnostics,
    };
}
