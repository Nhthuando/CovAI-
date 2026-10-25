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
          filenameTransform: (name) => name.replace(/\\/g, "/").replace(/^\/+/, ""),
        });
        const extracted = extractor.extract({
          files: (header) => {
            const normName = (header.name || "").replace(/\\/g, "/");
            return (
              !normName.includes("node_modules/") &&
              !normName.includes(".git/") &&
              !normName.includes("__MACOSX/") &&
              !normName.endsWith(".DS_Store")
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
        const allEntries = Array.from(extracted.files).filter((f) => {
          const normName = (f.fileHeader.name || "").replace(/\\/g, "/");
          return (
            !normName.includes("node_modules/") &&
            !normName.includes(".git/") &&
            !normName.includes("__MACOSX/") &&
            !normName.endsWith(".DS_Store")
          );
        });

        // 1. Create directories (ensuring empty directories exist)
        for (const item of allEntries) {
          if (item.fileHeader.flags?.directory) {
            const cleanName = (item.fileHeader.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
            if (cleanName) {
              await fs.promises.mkdir(path.join(outputDir, cleanName), { recursive: true }).catch(() => {});
            }
          }
        }

        // 2. Write files
        const files = allEntries.filter((f) => !f.fileHeader.flags?.directory);
        const batchSize = 50;
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (fileItem) => {
              const cleanName = (fileItem.fileHeader.name || "").replace(
                /\\/g,
                "/",
              ).replace(/^\/+/, "");
              const filePath = path.join(outputDir, cleanName);
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

      // 1. Create directories first (ensuring empty directories are preserved)
      const dirs = directory.files.filter((f) => {
        const normPath = (f.path || "").replace(/\\/g, "/");
        return (
          (f.type === "Directory" || normPath.endsWith("/")) &&
          !normPath.includes("node_modules/") &&
          !normPath.includes(".git/") &&
          !normPath.includes("__MACOSX/")
        );
      });
      for (const d of dirs) {
        const cleanPath = (d.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
        if (cleanPath) {
          await fs.promises.mkdir(path.join(outputDir, cleanPath), { recursive: true }).catch(() => {});
        }
      }

      // 2. Extract regular files
      const files = directory.files.filter((f) => {
        const normPath = (f.path || "").replace(/\\/g, "/");
        return (
          f.type !== "Directory" &&
          !normPath.endsWith("/") &&
          !normPath.includes("node_modules/") &&
          !normPath.includes(".git/") &&
          !normPath.includes("__MACOSX/") &&
          !normPath.endsWith(".DS_Store")
        );
      });

      const batchSize = 50;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (file) => {
            const cleanPath = (file.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
            const fullPath = path.join(outputDir, cleanPath);
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
