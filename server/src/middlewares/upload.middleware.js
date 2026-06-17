import multer from "multer";
import path from "path";
import unzipper from "unzipper";
import { createExtractorFromData } from "node-unrar-js";

const ALLOWED_MIMETYPES = [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-zip",
    "multipart/x-zip",
    // RAR mimetypes
    "application/vnd.rar",
    "application/x-rar-compressed",
    "application/octet-stream", // Sometimes rar is detected as octet-stream
];

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB cho file nén
const MAX_UNCOMPRESSED_SIZE = 1024 * 1024 * 1024; // 1GB không nén
const MAX_ENTRY_COUNT = 10000;
const MAX_COMPRESSION_RATIO = 150;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const validMime = ALLOWED_MIMETYPES.includes(file.mimetype);
        const validExt = ext === ".zip" || ext === ".rar";

        if (validMime && validExt) {
            cb(null, true);
        } else {
            cb(new Error("Chỉ chấp nhận file .zip hoặc .rar!"), false);
        }
    },
});

export const uploadSingleArchive = (req, res, next) => {
    upload.single("file")(req, res, (err) => {
        if (!err) return next();

        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: err.message });
        }

        return res.status(400).json({ message: err.message || "Upload thất bại." });
    });
};

const BLACKLIST_EXTENSIONS = ['.env', '.pem', '.key'];

export const scanArchiveBomb = async (buffer, filename) => {
    const ext = path.extname(filename).toLowerCase();

    let totalUncompressedSize = 0;
    let entryCount = 0;

    if (ext === ".zip") {
        const directory = await unzipper.Open.buffer(buffer);

        for (const file of directory.files) {
            // Auto skip tracking for node_modules and .git (safe and useless)
            if (file.path.includes("node_modules/") || file.path.includes(".git/")) continue;

            entryCount++;

            if (entryCount > MAX_ENTRY_COUNT) {
                throw new Error("Archive chứa quá nhiều file bên trong.");
            }

            const normalized = path.normalize(file.path);
            if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
                throw new Error("Phát hiện path traversal trong Archive.");
            }

            if (file.type === "Symlink") {
                throw new Error("Không chấp nhận symlink trong Archive.");
            }

            if (path.extname(file.path).toLowerCase() === ".zip" || path.extname(file.path).toLowerCase() === ".rar") {
                throw new Error("Không chấp nhận Archive lồng nhau.");
            }

            const entryExt = path.extname(file.path).toLowerCase();
            if (BLACKLIST_EXTENSIONS.includes(entryExt)) {
                throw new Error(`Phát hiện file không được phép: ${file.path}`);
            }

            if (file.uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
                throw new Error("Một file bên trong Archive quá lớn.");
            }

            totalUncompressedSize += file.uncompressedSize;

            if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
                throw new Error("Tổng dung lượng sau khi giải nén quá lớn.");
            }

            const ratio = file.uncompressedSize / (file.compressedSize || 1);
            if (ratio > MAX_COMPRESSION_RATIO) {
                throw new Error("Tỉ lệ nén bất thường, nghi ngờ archive bomb.");
            }
        }
    } else if (ext === ".rar") {
        try {
            // node-unrar-js requires Uint8Array
            const uint8Array = new Uint8Array(buffer);
            const extractor = await createExtractorFromData({ data: uint8Array });
            
            const list = extractor.getFileList();
            const fileHeaders = Array.from(list.fileHeaders);

            for (const fileHeader of fileHeaders) {
                if (fileHeader.flags && fileHeader.flags.directory) {
                    continue;
                }

                const filePath = fileHeader.name;
                // Auto skip tracking for node_modules and .git
                if (filePath.includes("node_modules/") || filePath.includes(".git/")) continue;

                entryCount++;
                if (entryCount > MAX_ENTRY_COUNT) {
                    throw new Error("Archive chứa quá nhiều file bên trong.");
                }

                const normalized = path.normalize(filePath);
                if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
                    throw new Error("Phát hiện path traversal trong Archive.");
                }

                if (path.extname(filePath).toLowerCase() === ".zip" || path.extname(filePath).toLowerCase() === ".rar") {
                    throw new Error("Không chấp nhận Archive lồng nhau.");
                }

                const entryExt = path.extname(filePath).toLowerCase();
                if (BLACKLIST_EXTENSIONS.includes(entryExt)) {
                    throw new Error(`Phát hiện file không được phép: ${filePath}`);
                }

                const unpSize = fileHeader.unpSize || 0;
                const packSize = fileHeader.packSize || 1;

                if (unpSize > MAX_UNCOMPRESSED_SIZE) {
                    throw new Error("Một file bên trong Archive quá lớn.");
                }

                totalUncompressedSize += unpSize;

                if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
                    throw new Error("Tổng dung lượng sau khi giải nén quá lớn.");
                }

                const ratio = unpSize / packSize;
                if (ratio > MAX_COMPRESSION_RATIO) {
                    throw new Error("Tỉ lệ nén bất thường, nghi ngờ archive bomb.");
                }
            }
        } catch (error) {
            throw new Error(`Lỗi đọc file RAR: ${error.message}`);
        }
    }
};

export default upload;