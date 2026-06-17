import { getBucket } from "../config/firebase.js";
import unzipper from "unzipper";
import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";
import { createExtractorFromData } from "node-unrar-js";

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

export const extractZipSnapshot = async (snapshotId, storagePath) => {
    assertStringField(snapshotId, "snapshotId");
    assertStringField(storagePath, "storagePath");

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

        const ext = path.extname(storagePath).toLowerCase();
        
        if (ext === ".rar") {
            const extractor = await createExtractorFromData({ data: new Uint8Array(zipBuffer) });
            const extracted = extractor.extract({ files: () => true });
            const files = Array.from(extracted.files);

            for (const fileItem of files) {
                if (fileItem.fileHeader.flags.directory) {
                    continue;
                }

                if (fileItem.fileHeader.name.includes("node_modules/") || fileItem.fileHeader.name.includes(".git/")) {
                    continue;
                }

                const filePath = path.join(outputDir, fileItem.fileHeader.name);
                const fileDir = path.dirname(filePath);

                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }

                if (fileItem.extraction) {
                    fs.writeFileSync(filePath, fileItem.extraction);
                }
            }
        } else {
            const directory = await unzipper.Open.buffer(zipBuffer);
            for (const file of directory.files) {
                if (file.type === "Directory") continue;
                if (file.path.includes("node_modules/") || file.path.includes(".git/")) continue;

                const fullPath = path.join(outputDir, file.path);
                const dir = path.dirname(fullPath);
                
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const buffer = await file.buffer();
                fs.writeFileSync(fullPath, buffer);
            }
        }

        return outputDir;
    } catch (error) {
        if (dirCreatedByUs && fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }
        throw new Error(`Lỗi giải nén: ${error?.message ?? String(error)}`);
    }
};
