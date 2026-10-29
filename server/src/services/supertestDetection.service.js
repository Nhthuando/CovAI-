import {
    detectIntegrationFrameworks,
    classifyIntegrationPermutation,
    installIntegrationDependencies,
} from "./integrationDetection.service.js";

/**
 * Detect Supertest dependency, imports, test files and Jest configuration in a snapshot.
 * Backward-compatible bridge to detectIntegrationFrameworks.
 * 
 * @param {string} rootDir - Project root directory
 * @returns {Promise<Object>} Detection results
 */
export const detectSupertest = async (rootDir) => {
    const integration = await detectIntegrationFrameworks(rootDir);
    const supertestFiles = integration.supertestFiles || [];
    const version = integration.supertest?.version ?? null;
    const detected = Boolean(version || supertestFiles.length > 0);

    return {
        detected,
        version,
        framework: integration.runner || (detected ? "jest" : null),
        pathway: supertestFiles.length > 0 ? "BROWNFIELD" : "GREENFIELD",
        testFiles: integration.testFiles || [],
        supertestFiles,
        playwrightApiFiles: integration.playwrightApiFiles || [],
        configFile: integration.configFile,
        configPath: integration.configPath,
        testCommand: integration.testCommand,
        detectionReasons: integration.detectionReasons || [],
        permutation: integration.permutation,
        permutationDetails: integration.permutationDetails,
    };
};

export {
    detectIntegrationFrameworks,
    classifyIntegrationPermutation,
    installIntegrationDependencies,
};
