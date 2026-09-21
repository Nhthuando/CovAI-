import { getBucket } from "../config/firebase.js";
import unzipper from "unzipper";
import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";
import {
  createExtractorFromData,
  createExtractorFromFile,
} from "node-unrar-js";

const assertStringField = (value, fieldName) => {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError(`${fieldName} is required`, 400);
  }
};

export const extractZipSnapshot = async (
  snapshotId,
  storagePath,
  filePathOrBuffer = null,
) => {
  assertStringField(snapshotId, "snapshotId");
  assertStringField(storagePath, "storagePath");

  const outputDir = path.resolve(`uploads/snapshots/${snapshotId}`);
  let dirCreatedByUs = false;

  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      dirCreatedByUs = true;
    }

    let archiveSource = filePathOrBuffer;
    if (!archiveSource) {
      const bucket = getBucket();
      const file = bucket.file(storagePath);
      const [downloaded] = await file.download();
      archiveSource = downloaded;
    }

    const ext = path.extname(storagePath).toLowerCase();
    const isFilePath =
      typeof archiveSource === "string" && fs.existsSync(archiveSource);

    if (ext === ".rar") {
      if (isFilePath) {
        // Stream directly from disk file to output directory!
        const extractor = await createExtractorFromFile({
          filepath: archiveSource,
          targetPath: outputDir,
          filenameTransform: (name) => name.replace(/\\/g, "/"),
        });
        const extracted = extractor.extract({
          files: (header) => {
            const normName = (header.name || "").replace(/\\/g, "/");
            return (
              !header.flags.directory &&
              !normName.includes("node_modules/") &&
              !normName.includes(".git/")
            );
          },
        });
        // Drain generator to complete file extraction to disk
        for (const _ of extracted.files) {
        }
      } else {
        // Fallback for memory buffer
        const extractor = await createExtractorFromData({
          data: new Uint8Array(archiveSource),
        });
        const extracted = extractor.extract({ files: () => true });
        const files = Array.from(extracted.files).filter((f) => {
          const normName = (f.fileHeader.name || "").replace(/\\/g, "/");
          return (
            !f.fileHeader.flags.directory &&
            !normName.includes("node_modules/") &&
            !normName.includes(".git/")
          );
        });

        const batchSize = 50;
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (fileItem) => {
              const normName = (fileItem.fileHeader.name || "").replace(
                /\\/g,
                "/",
              );
              const filePath = path.join(outputDir, normName);
              const fileDir = path.dirname(filePath);

              await fs.promises.mkdir(fileDir, { recursive: true });
              if (fileItem.extraction) {
                await fs.promises.writeFile(
                  filePath,
                  Buffer.from(fileItem.extraction),
                );
              }
            }),
          );
        }
      }
    } else {
      const directory = isFilePath
        ? await unzipper.Open.file(archiveSource)
        : await unzipper.Open.buffer(archiveSource);

      const files = directory.files.filter((f) => {
        const normPath = (f.path || "").replace(/\\/g, "/");
        return (
          f.type !== "Directory" &&
          !normPath.includes("node_modules/") &&
          !normPath.includes(".git/")
        );
      });

      const batchSize = 50;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (file) => {
            const normPath = (file.path || "").replace(/\\/g, "/");
            const fullPath = path.join(outputDir, normPath);
            const dir = path.dirname(fullPath);

            await fs.promises.mkdir(dir, { recursive: true });
            const buffer = await file.buffer();
            await fs.promises.writeFile(fullPath, buffer);
          }),
        );
      }
    }

    return outputDir;
  } catch (error) {
    if (dirCreatedByUs && fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    throw new Error(`Extraction failed: ${error?.message ?? String(error)}`);
  }
};
