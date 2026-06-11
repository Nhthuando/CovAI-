import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { getBucket } from "../config/firebase.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * SCRUM-113: Đảm bảo thư mục coverage tồn tại trong rootDir
 * (Jest tạo tự động, hàm này chỉ verify + tạo nếu thiếu)
 */
export const ensureCoverageOutputDir = (rootDir) => {
    const coverageDir = path.join(rootDir, "coverage");
    if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
    }
    return coverageDir;
};

/**
 * Upload một file lên Firebase Storage và trả về storagePath.
 * @param {Buffer} buffer   - Nội dung file
 * @param {string} destPath - Đường dẫn đích trên Firebase (e.g. coverage/xxx/summary.json)
 * @param {string} mimeType
 */
const uploadBufferToFirebase = async (buffer, destPath, mimeType) => {
    const blob = getBucket().file(destPath);
    await new Promise((resolve, reject) => {
        const stream = blob.createWriteStream({ metadata: { contentType: mimeType } });
        stream.on("error", reject);
        stream.on("finish", resolve);
        stream.end(buffer);
    });
    return destPath;
};

/**
 * SCRUM-84: Lưu các file coverage lên Firebase Storage và cập nhật snapshot.
 *
 * Upload:
 *  - SCRUM-114: coverage-summary.json
 *  - SCRUM-115: coverage-final.json
 *  - SCRUM-116: lcov.info
 *
 * SCRUM-117: Lưu storagePaths vào ProjectSnapshot.storageBasePath (JSON)
 *
 * @param {string} snapshotId
 * @param {string} projectId
 * @param {string} coverageDir  - Đường dẫn local tới thư mục coverage/
 * @returns {{ summaryPath, finalPath, lcovPath }} - Firebase storage paths
 */
export const storeCoverageOutputs = async (snapshotId, projectId, coverageDir) => {
    if (!snapshotId || !projectId || !coverageDir) {
        throw new ServiceError("snapshotId, projectId và coverageDir là bắt buộc", 400);
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
        console.warn(`[CoverageStorage] Không tìm thấy coverage-summary.json tại ${summaryFile}`);
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
        console.warn(`[CoverageStorage] Không tìm thấy coverage-final.json tại ${finalFile}`);
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
        console.warn(`[CoverageStorage] Không tìm thấy lcov.info tại ${lcovFile}`);
    }

    // ── SCRUM-117: Associate outputs với Snapshot ─────────────────────────
    // Lưu storage paths vào storageBasePath của snapshot (dưới dạng JSON prefix)
    await prisma.projectSnapshot.update({
        where: { id: snapshotId },
        data: {
            storageBasePath: baseStoragePath,
        },
    });

    console.log(`[CoverageStorage] Snapshot ${snapshotId} cập nhật storageBasePath = ${baseStoragePath}`);

    return {
        baseStoragePath,
        ...results,
    };
};
