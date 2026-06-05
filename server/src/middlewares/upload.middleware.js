import multer from "multer";
import path from "path";
import unzipper from "unzipper";

const ALLOWED_MIMETYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "multipart/x-zip",
];

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_SIZE = 200 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1000;
const MAX_COMPRESSION_RATIO = 100;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const validMime = ALLOWED_MIMETYPES.includes(file.mimetype);
        const validExt = ext === ".zip";

        if (validMime && validExt) {
        cb(null, true);
        } else {
        cb(new Error("Chỉ chấp nhận file .zip!"), false);
        }
    },
});

export const uploadSingleZip = (req, res, next) => {
    upload.single("file")(req, res, (err) => {
        if (!err) return next();

        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: err.message });
        }

        return res.status(400).json({ message: err.message || "Upload thất bại." });
    });
};

export const scanZipBomb = async (buffer) => {
    let totalUncompressedSize = 0;
    let entryCount = 0;

    const directory = await unzipper.Open.buffer(buffer);

    for (const file of directory.files) {
        entryCount++;

        if (entryCount > MAX_ENTRY_COUNT) {
        throw new Error("ZIP chứa quá nhiều file bên trong.");
        }

        const normalized = path.normalize(file.path);
        if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        throw new Error("Phát hiện path traversal trong ZIP.");
        }

        if (file.type === "Symlink") {
        throw new Error("Không chấp nhận symlink trong ZIP.");
        }

        if (path.extname(file.path).toLowerCase() === ".zip") {
        throw new Error("Không chấp nhận ZIP lồng nhau.");
        }

        if (file.uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
        throw new Error("Một file bên trong ZIP quá lớn.");
        }

        totalUncompressedSize += file.uncompressedSize;

        if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
        throw new Error("Tổng dung lượng sau khi giải nén quá lớn.");
        }

        const ratio = file.uncompressedSize / (file.compressedSize || 1);
        if (ratio > MAX_COMPRESSION_RATIO) {
        throw new Error("Tỉ lệ nén bất thường, nghi ngờ zip bomb.");
        }
    }
}

export default upload;