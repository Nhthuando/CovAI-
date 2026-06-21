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

export const extractZipSnapshot = async (snapshotId, storagePath, fileBuffer = null) => {
    assertStringField(snapshotId, "snapshotId");
    assertStringField(storagePath, "storagePath");

    const outputDir = path.resolve(`uploads/snapshots/${snapshotId}`);
    let dirCreatedByUs = false;

    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            dirCreatedByUs = true;
        }

        let zipBuffer = fileBuffer;
        if (!zipBuffer) {
            const bucket = getBucket();
            const file = bucket.file(storagePath);
            const [downloaded] = await file.download();
            zipBuffer = downloaded;
        }

        const ext = path.extname(storagePath).toLowerCase();
        
        if (ext === ".rar") {
            const extractor = await createExtractorFromData({ data: new Uint8Array(zipBuffer) });
            const extracted = extractor.extract({ files: () => true });
            const files = Array.from(extracted.files).filter(f => 
                !f.fileHeader.flags.directory && 
                !f.fileHeader.name.includes("node_modules/") && 
                !f.fileHeader.name.includes(".git/")
            );

            const batchSize = 50;
            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                await Promise.all(batch.map(async (fileItem) => {
                    const filePath = path.join(outputDir, fileItem.fileHeader.name);
                    const fileDir = path.dirname(filePath);
                    
                    await fs.promises.mkdir(fileDir, { recursive: true });
                    if (fileItem.extraction) {
                        await fs.promises.writeFile(filePath, fileItem.extraction);
                    }
                }));
            }
        } else {
            const directory = await unzipper.Open.buffer(zipBuffer);
            const files = directory.files.filter(f => 
                f.type !== "Directory" && 
                !f.path.includes("node_modules/") && 
                !f.path.includes(".git/")
            );

            const batchSize = 50;
            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                await Promise.all(batch.map(async (file) => {
                    const fullPath = path.join(outputDir, file.path);
                    const dir = path.dirname(fullPath);
                    
                    await fs.promises.mkdir(dir, { recursive: true });
                    const buffer = await file.buffer();
                    await fs.promises.writeFile(fullPath, buffer);
                }));
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
