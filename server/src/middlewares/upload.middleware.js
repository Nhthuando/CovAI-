import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import unzipper from "unzipper";
import {
  createExtractorFromData,
  createExtractorFromFile,
} from "node-unrar-js";

const tempUploadDir = path.resolve("uploads/temp");
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB cho file nén
const MAX_UNCOMPRESSED_SIZE = 1024 * 1024 * 1024; // 1GB không nén
const MAX_ENTRY_COUNT = 10000;
const MAX_COMPRESSION_RATIO = 150;

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validExt = ext === ".zip" || ext === ".rar";

    if (validExt) {
      cb(null, true);
    } else {
      cb(new Error("Only .zip and .rar files are accepted!"), false);
    }
  },
});

export const uploadSingleArchive = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: err.message });
    }

    return res.status(400).json({ message: err.message || "Upload failed." });
  });
};

const BLACKLIST_EXTENSIONS = [".env", ".pem", ".key"];

export const scanArchiveBomb = async (source, filename) => {
  const ext = path.extname(filename).toLowerCase();
  const isFilePath = typeof source === "string";

  let totalUncompressedSize = 0;
  let entryCount = 0;

  if (ext === ".zip") {
    const directory = isFilePath
      ? await unzipper.Open.file(source)
      : await unzipper.Open.buffer(source);

    for (const file of directory.files) {
      const rawPath = file.path.replace(/\\/g, "/");
      // Auto skip tracking for node_modules and .git (safe and useless)
      if (rawPath.includes("node_modules/") || rawPath.includes(".git/"))
        continue;

      entryCount++;

      if (entryCount > MAX_ENTRY_COUNT) {
        throw new Error("Archive contains too many files.");
      }

      const normalized = path.normalize(rawPath).replace(/\\/g, "/");
      if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        throw new Error("Path traversal detected in archive.");
      }

      if (file.type === "Symlink") {
        throw new Error("Symlinks are not allowed in archive.");
      }

      if (
        path.extname(rawPath).toLowerCase() === ".zip" ||
        path.extname(rawPath).toLowerCase() === ".rar"
      ) {
        throw new Error("Nested archives are not allowed.");
      }

      const entryExt = path.extname(rawPath).toLowerCase();
      if (BLACKLIST_EXTENSIONS.includes(entryExt)) {
        throw new Error(`Disallowed file detected: ${rawPath}`);
      }

      if (file.uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
        throw new Error(
          "A file inside the archive exceeds the maximum allowed size.",
        );
      }

      totalUncompressedSize += file.uncompressedSize;

      if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
        throw new Error("Total uncompressed size exceeds the maximum limit.");
      }

      const ratio = file.uncompressedSize / (file.compressedSize || 1);
      if (ratio > MAX_COMPRESSION_RATIO) {
        throw new Error("Abnormal compression ratio, suspected archive bomb.");
      }
    }
  } else if (ext === ".rar") {
    try {
      const extractor = isFilePath
        ? await createExtractorFromFile({ filepath: source })
        : await createExtractorFromData({ data: new Uint8Array(source) });

      const list = extractor.getFileList();
      const fileHeaders = Array.from(list.fileHeaders);

      for (const fileHeader of fileHeaders) {
        if (fileHeader.flags && fileHeader.flags.directory) {
          continue;
        }

        const filePath = (fileHeader.name || "").replace(/\\/g, "/");
        // Auto skip tracking for node_modules and .git
        if (filePath.includes("node_modules/") || filePath.includes(".git/"))
          continue;

        entryCount++;
        if (entryCount > MAX_ENTRY_COUNT) {
          throw new Error("Archive contains too many files.");
        }

        const normalized = path.normalize(filePath).replace(/\\/g, "/");
        if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
          throw new Error("Path traversal detected in archive.");
        }

        if (
          path.extname(filePath).toLowerCase() === ".zip" ||
          path.extname(filePath).toLowerCase() === ".rar"
        ) {
          throw new Error("Nested archives are not allowed.");
        }

        const entryExt = path.extname(filePath).toLowerCase();
        if (BLACKLIST_EXTENSIONS.includes(entryExt)) {
          throw new Error(`Disallowed file detected: ${filePath}`);
        }

        const unpSize = fileHeader.unpSize || 0;
        const packSize = fileHeader.packSize || 1;

        if (unpSize > MAX_UNCOMPRESSED_SIZE) {
          throw new Error(
            "A file inside the archive exceeds the maximum allowed size.",
          );
        }

        totalUncompressedSize += unpSize;

        if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
          throw new Error("Total uncompressed size exceeds the maximum limit.");
        }

        const ratio = unpSize / packSize;
        if (ratio > MAX_COMPRESSION_RATIO) {
          throw new Error(
            "Abnormal compression ratio, suspected archive bomb.",
          );
        }
      }
    } catch (error) {
      throw new Error(`Error reading RAR file: ${error.message}`);
    }
  }
};

export default upload;
