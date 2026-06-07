import { getBucket } from "../config/firebase.js";
import unzipper from "unzipper";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const extractZipSnapshot = async (snapshotId, storagePath) => {
    const outputDir = path.resolve(`uploads/snapshots/${snapshotId}`);
    let dirCreatedByUs = false;

    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            dirCreatedByUs = true;
        }

        const bucket = getBucket();
        const file = bucket.file(storagePath);
        const [zipBuffer] = await file.download();

        await pipeline(
            Readable.from(zipBuffer),
            unzipper.Extract({ path: outputDir })
        );

        return outputDir;
    } catch (error) {
        if (dirCreatedByUs && fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }
        throw new Error(`Lỗi giải nén: ${error?.message ?? String(error)}`);
    }
};
