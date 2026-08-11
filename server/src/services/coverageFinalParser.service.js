import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Parse coverage-final.json (Istanbul format)
 * Maps to CoverageFile and CoverageFunction models.
 */

export const parseCoverageFinal = async (coverageDir, snapshotId) => {
    const finalPath = path.join(coverageDir, "coverage-final.json");

    if (!fs.existsSync(finalPath)) {
        throw new ServiceError(`File not found: ${finalPath}`, 404);
    }

    let coverageData;
    try {
        coverageData = JSON.parse(fs.readFileSync(finalPath, "utf8"));
    } catch (err) {
        throw new ServiceError(`Failed to parse coverage-final.json: ${err.message}`, 422);
    }

    for (const [filePath, fileData] of Object.entries(coverageData)) {
        // Normalize path if needed (assuming relative to project root)
        const normalizedPath = filePath.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, "");

        // 1. Parse Function Coverage
        if (fileData.fnMap && fileData.f) {
            for (const [fnId, fnMeta] of Object.entries(fileData.fnMap)) {
                const hitCount = fileData.f[fnId] || 0;
                const functionName = fnMeta.name === "(anonymous)" ? `anonymous_${fnId}` : fnMeta.name;

                await prisma.coverageFunction.upsert({
                    where: {
                        snapshotId_filePath_functionName_startLine: {
                            snapshotId,
                            filePath: normalizedPath,
                            functionName,
                            startLine: fnMeta.decl.start.line
                        }
                    },
                    create: {
                        snapshotId,
                        filePath: normalizedPath,
                        functionName,
                        startLine: fnMeta.decl.start.line,
                        endLine: fnMeta.decl.end.line,
                        hit: hitCount
                    },
                    update: {
                        hit: hitCount
                    }
                });
            }
        }
    }

    return { success: true };
};