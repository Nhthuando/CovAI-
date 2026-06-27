import prisma from "../config/prisma.js";
import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";
import { generateInputHash, reuseCachedContext, saveCacheRecord } from "./aiContextCache.service.js";

// Helper to collect files recursively
function collectFiles(dir, isMatch, rootDir = dir) {
    let results = [];
    try {
        if (!fs.existsSync(dir)) return results;
        const items = fs.readdirSync(dir);
        for (const item of items) {
            if (item === "node_modules" || item === ".git") continue;

            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);

            if (stat.isDirectory()) {
                results = results.concat(collectFiles(itemPath, isMatch, rootDir));
            } else {
                if (isMatch(item, itemPath)) {
                    // Limit file size to avoid loading huge minified or generated files
                    if (stat.size <= 500 * 1024) { // max 500KB per file
                        const content = fs.readFileSync(itemPath, "utf-8");
                        const relativePath = path.relative(rootDir, itemPath).replace(/\\/g, "/");
                        results.push({
                            path: relativePath,
                            content,
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error collecting files:", e);
    }
    return results;
}

/**
 * SCRUM-380: Load source code
 */
export const loadSourceCode = async (snapshotId) => {
    const snapshot = await prisma.projectSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot || !snapshot.rootDir) {
        throw new ServiceError("Snapshot root directory not found", 404);
    }

    const isSourceMatch = (fileName, filePath) => {
        const ext = path.extname(fileName).toLowerCase();
        const validExts = [".js", ".jsx", ".ts", ".tsx"];
        const isTest = fileName.includes(".test.") || fileName.includes(".spec.");
        return validExts.includes(ext) && !isTest;
    };

    return collectFiles(snapshot.rootDir, isSourceMatch);
};

/**
 * SCRUM-383: Load existing test files
 */
export const loadTestFiles = async (snapshotId) => {
    const snapshot = await prisma.projectSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot || !snapshot.rootDir) {
        throw new ServiceError("Snapshot root directory not found", 404);
    }

    const isTestMatch = (fileName, filePath) => {
        const ext = path.extname(fileName).toLowerCase();
        const validExts = [".js", ".jsx", ".ts", ".tsx"];
        const isTest = fileName.includes(".test.") || fileName.includes(".spec.");
        return validExts.includes(ext) && isTest;
    };

    return collectFiles(snapshot.rootDir, isTestMatch);
};

/**
 * SCRUM-384: Load Cyclomatic Complexity data
 */
export const loadComplexityMetrics = async (snapshotId) => {
    const metrics = await prisma.cyclomatic.findMany({
        where: { snapshotId },
        select: {
            filePath: true,
            functionName: true,
            value: true
        }
    });
    return metrics;
};

/**
 * SCRUM-385: Load CFG data
 */
export const loadCfgData = async (snapshotId) => {
    const cfgs = await prisma.cfg.findMany({
        where: { snapshotId },
        select: {
            filePath: true,
            functionName: true,
            startLine: true,
            endLine: true,
            graphJson: true
        }
    });
    return cfgs;
};

/**
 * SCRUM-379: Load CoverageFunction data
 */
export const loadCoverageData = async (snapshotId) => {
    const summary = await prisma.coverageSummary.findUnique({
        where: { snapshotId },
    });

    const files = await prisma.coverageFile.findMany({
        where: { snapshotId },
        select: { filePath: true, linesPct: true, branchesPct: true, funcsPct: true, stmtsPct: true }
    });

    const functions = await prisma.coverageFunction.findMany({
        where: { snapshotId },
        select: { filePath: true, functionName: true, startLine: true, hit: true }
    });

    return {
        summary,
        files,
        functions
    };
};

/**
 * SCRUM-381: Validate context size
 */
export const validateContextSize = (payloadJson) => {
    // Limit context size to 20 MB to avoid excessive memory usage and ensure it fits within Gemini's context window.
    const MAX_SIZE_BYTES = 20 * 1024 * 1024;
    const sizeInBytes = Buffer.byteLength(payloadJson, 'utf8');
    
    if (sizeInBytes > MAX_SIZE_BYTES) {
        throw new ServiceError(`Context size exceeds limit: ${(sizeInBytes / 1024 / 1024).toFixed(2)} MB > 20 MB`, 400);
    }
    
    return true;
};

/**
 * SCRUM-382: Build AI context object
 */
export const buildAiPayload = async (snapshotId, forceRebuild = false) => {
    try {
        if (!forceRebuild) {
            try {
                const cachedPayload = await reuseCachedContext(snapshotId);
                if (cachedPayload) {
                    console.log(`[AIContextBuilder] Reusing cached context for snapshot ${snapshotId}`);
                    return {
                        payload: cachedPayload,
                        payloadJson: JSON.stringify(cachedPayload),
                        cached: true
                    };
                }
            } catch (cacheError) {
                // Cache not found or invalid, proceed to build
            }
        }

        const [sourceCode, testFiles, complexity, cfg, coverage] = await Promise.all([
            loadSourceCode(snapshotId).catch(() => []),
            loadTestFiles(snapshotId).catch(() => []),
            loadComplexityMetrics(snapshotId).catch(() => []),
            loadCfgData(snapshotId).catch(() => []),
            loadCoverageData(snapshotId).catch(() => ({}))
        ]);

        const payload = {
            snapshotId,
            sourceCode,
            testFiles,
            complexity,
            cfg,
            coverage
        };

        const payloadJson = JSON.stringify(payload);
        
        // Validate context size (SCRUM-381)
        validateContextSize(payloadJson);

        // Generate hash (SCRUM-280)
        const inputHash = generateInputHash(payloadJson);

        // Save cache record (SCRUM-283)
        const contextCache = await saveCacheRecord(snapshotId, inputHash, payloadJson);

        return {
            payload,
            payloadJson,
            inputHash,
            contextCache,
            cached: false
        };
    } catch (error) {
        console.error(`[AIContextBuilder] Lỗi khi build payload cho snapshot ${snapshotId}:`, error);
        throw new ServiceError("Failed to build AI payload", 500);
    }
};
