import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { ServiceError } from "../utils/serviceError.js";

const excludedDirectories = new Set([
    ".git", ".svn", ".hg", "node_modules", "vendor", "dist", "build", "coverage", ".cache", ".next", ".nuxt", ".turbo",
    "playwright-report", "test-results", ".aws", ".ssh", ".gnupg", "__pycache__", ".venv", "venv",
]);
const isPrivateFile = (name) => {
    const lower = name.toLowerCase();
    // Explicitly allow environment templates, never their backups or local variants.
    if ([".env.example", ".env.sample", ".env.template"].includes(lower)) return false;
    return /(^|\.)env($|[._-])/.test(lower) || /\.(pem|key|p12|pfx|jks|keystore)(\.|$)/.test(lower)
        || /credential|service.?account|firebase.?adminsdk|secrets?\.|(^|[._-])id_(rsa|ed25519|ecdsa)/.test(lower)
        || [".npmrc", ".yarnrc", ".yarnrc.yml", ".netrc", ".pypirc", ".ds_store", "thumbs.db", ".covai-checkpoint.json"].includes(lower);
};

export const createProjectArchive = async (rootDir, { maxFiles = 10000, maxBytes = 100 * 1024 * 1024 } = {}) => {
    if (!rootDir) throw new ServiceError("Snapshot source is not ready for export", 409);
    let root;
    try {
        const stat = await fs.lstat(rootDir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid source root");
        root = await fs.realpath(rootDir);
    } catch { throw new ServiceError("Snapshot source is unavailable; import or restore it before exporting", 409); }
    const zip = new AdmZip();
    let fileCount = 0, excludedCount = 0, totalBytes = 0, visitedEntries = 0;
    const tooLarge = () => new ServiceError("Project export exceeds the limit of 10,000 files or 100 MiB. Remove large assets and try again.", 413);
    const visit = async (directory) => {
        const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (++visitedEntries > 20000) throw new ServiceError("Project contains too many directory entries to export (maximum 20,000).", 413);
            if (excludedDirectories.has(entry.name.toLowerCase()) || isPrivateFile(entry.name)) { excludedCount++; continue; }
            const absolute = path.join(directory, entry.name);
            const stat = await fs.lstat(absolute);
            if (stat.isSymbolicLink()) { excludedCount++; continue; }
            const real = await fs.realpath(absolute);
            const relative = path.relative(root, real);
            if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
                throw new ServiceError("Source changed during export; try again", 409);
            }
            if (stat.isDirectory()) { await visit(real); continue; }
            if (!stat.isFile()) { excludedCount++; continue; }
            if (fileCount >= maxFiles || totalBytes + stat.size > maxBytes) throw tooLarge();
            // O_NOFOLLOW protects the final component on platforms that support it.
            const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
            try {
                const current = await handle.stat();
                if (!current.isFile() || current.ino !== stat.ino || current.dev !== stat.dev) {
                    throw new ServiceError("Source changed during export; try again", 409);
                }
                if (totalBytes + current.size > maxBytes) throw tooLarge();
                // Read bounded chunks, including a one-byte probe for concurrent growth.
                const chunks = [];
                let bytes = 0;
                while (true) {
                    const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - totalBytes - bytes + 1));
                    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
                    if (!bytesRead) break;
                    bytes += bytesRead;
                    if (totalBytes + bytes > maxBytes) throw tooLarge();
                    chunks.push(chunk.subarray(0, bytesRead));
                }
                zip.addFile(path.relative(root, absolute).split(path.sep).join("/"), Buffer.concat(chunks));
                totalBytes += bytes; fileCount++;
            } finally { await handle.close(); }
        }
    };
    try { await visit(root); } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError("Source could not be read or changed during export; try again", 409);
    }
    if (!fileCount) throw new ServiceError("No exportable source files were found in this snapshot", 409);
    return { buffer: zip.toBuffer(), fileCount, excludedCount, totalBytes };
};
