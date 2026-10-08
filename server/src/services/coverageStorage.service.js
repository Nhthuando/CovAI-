import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { getBucket } from "../config/firebase.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * SCRUM-113: Ensure coverage directory exists in rootDir
 * (Jest creates automatically; this verifies and creates if missing)
 */
export const ensureCoverageOutputDir = (rootDir) => {
    const coverageDir = path.join(rootDir, "coverage");
    if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
    }
    return coverageDir;
};

/**
 * Upload a file to Firebase Storage and return storagePath.
 * @param {Buffer} buffer   - File content
 * @param {string} destPath - Destination path on Firebase (e.g. coverage/xxx/summary.json)
 * @param {string} mimeType
 */
const uploadBufferToFirebase = async (buffer, destPath, mimeType) => {
    try {
        const uploadPromise = new Promise((resolve, reject) => {
            const blob = getBucket().file(destPath);
            const stream = blob.createWriteStream({ metadata: { contentType: mimeType } });
            stream.on("error", reject);
            stream.on("finish", resolve);
            stream.end(buffer);
        });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Firebase upload timeout (10s) for ${destPath}`)), 10000)
        );
        await Promise.race([uploadPromise, timeoutPromise]);
        return destPath;
    } catch (err) {
        console.warn(`[CoverageStorage] Firebase upload warning for ${destPath}: ${err.message}`);
        return null;
    }
};

/**
 * SCRUM-84: Save coverage files to Firebase Storage and update snapshot.
 *
 * Upload:
 *  - SCRUM-114: coverage-summary.json
 *  - SCRUM-115: coverage-final.json
 *  - SCRUM-116: lcov.info
 *
 * SCRUM-117: Save storage prefix to ProjectSnapshot.storagePath
 *
 * @param {string} snapshotId
 * @param {string} projectId
 * @param {string} coverageDir  - Local path to coverage/ directory
 * @returns {{ summaryPath, finalPath, lcovPath }} - Firebase storage paths
 */
export const storeCoverageOutputs = async (snapshotId, projectId, coverageDir) => {
    if (!snapshotId || !projectId || !coverageDir) {
        throw new ServiceError("snapshotId, projectId and coverageDir are required", 400);
    }

    const baseStoragePath = `projects/${projectId}/snapshots/${snapshotId}/coverage`;
    const results = {};

    // ── SCRUM-114: Upload coverage-summary.json ───────────────────────────
    const summaryFile = path.join(coverageDir, "coverage-summary.json");
    if (fs.existsSync(summaryFile)) {
        const buf = fs.readFileSync(summaryFile);
        const dest = `${baseStoragePath}/coverage-summary.json`;
        await uploadBufferToFirebase(buf, dest, "application/json");
        results.summaryStoragePath = dest;
        console.log(`[CoverageStorage] Uploaded coverage-summary.json → ${dest}`);
    } else {
        console.warn(`[CoverageStorage] coverage-summary.json not found at ${summaryFile}`);
    }

    // ── SCRUM-115: Upload coverage-final.json ────────────────────────────
    const finalFile = path.join(coverageDir, "coverage-final.json");
    if (fs.existsSync(finalFile)) {
        const buf = fs.readFileSync(finalFile);
        const dest = `${baseStoragePath}/coverage-final.json`;
        await uploadBufferToFirebase(buf, dest, "application/json");
        results.finalStoragePath = dest;
        console.log(`[CoverageStorage] Uploaded coverage-final.json → ${dest}`);
    } else {
        console.warn(`[CoverageStorage] coverage-final.json not found at ${finalFile}`);
    }

    // ── SCRUM-116: Upload lcov.info ───────────────────────────────────────
    const lcovFile = path.join(coverageDir, "lcov.info");
    if (fs.existsSync(lcovFile)) {
        const buf = fs.readFileSync(lcovFile);
        const dest = `${baseStoragePath}/lcov.info`;
        await uploadBufferToFirebase(buf, dest, "text/plain");
        results.lcovStoragePath = dest;
        console.log(`[CoverageStorage] Uploaded lcov.info → ${dest}`);
    } else {
        console.warn(`[CoverageStorage] lcov.info not found at ${lcovFile}`);
    }

    // ── Integration Scenarios ───────────────────────────────────────
    const scenariosFile = path.join(coverageDir, "integration-scenarios.json");
    if (fs.existsSync(scenariosFile)) {
        const buf = fs.readFileSync(scenariosFile);
        const dest = `${baseStoragePath}/integration-scenarios.json`;
        await uploadBufferToFirebase(buf, dest, "application/json");
        results.scenariosStoragePath = dest;
        console.log(`[CoverageStorage] Uploaded integration-scenarios.json → ${dest}`);
    }

    // ── SCRUM-117: Associate outputs with Snapshot ────────────────────────
    // ProjectSnapshot uses the real Prisma field `storagePath`, not `storageBasePath`.
    await prisma.projectSnapshot.update({
        where: { id: snapshotId },
        data: {
            storagePath: baseStoragePath,
        },
    });

    console.log(`[CoverageStorage] Snapshot ${snapshotId} updated storagePath = ${baseStoragePath}`);

    return {
        baseStoragePath,
        ...results,
    };
};
