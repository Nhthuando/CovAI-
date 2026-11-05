import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

export const JOURNAL_DIR_NAME = ".covai_journal";

/**
 * Returns the path to the journal directory inside the project root.
 */
export function getJournalDir(rootDir) {
    return path.join(rootDir, JOURNAL_DIR_NAME);
}

/**
 * Syncs directory metadata to durable storage on POSIX filesystems.
 * Safe no-op on Windows.
 */
export function syncDirectorySync(dirPath) {
    if (process.platform === "win32") return;
    try {
        if (!fs.existsSync(dirPath)) return;
        const dirFd = fs.openSync(dirPath, "r");
        try {
            fs.fsyncSync(dirFd);
        } finally {
            fs.closeSync(dirFd);
        }
    } catch (_) {}
}

/**
 * Atomically writes a JSON file by writing to a temporary file, fsyncing, renaming, and fsyncing parent directory.
 */
function atomicWriteJsonSync(filePath, data) {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
        syncDirectorySync(path.dirname(parentDir));
    }

    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const content = JSON.stringify(data, null, 2);
    const fd = fs.openSync(tmpPath, "w");
    try {
        fs.writeSync(fd, content, "utf8");
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    // On Windows, if target exists, unlink first before rename to avoid EPERM
    if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
    }
    fs.renameSync(tmpPath, filePath);
    syncDirectorySync(parentDir);
}

/**
 * Initializes a durable apply transaction on disk.
 * Backs up existing files to durable backup copies with fsync before any modification.
 * Prevents hijacking of transactions owned by active, living processes.
 *
 * @param {Object} params
 * @param {string} params.rootDir
 * @param {string} params.snapshotId
 * @param {Array<{targetRelPath: string}>} params.targetFiles
 * @returns {Object} The initialized transaction manifest object
 */
export function initDurableTransaction({ rootDir, snapshotId, targetFiles = [] }) {
    if (!rootDir || !fs.existsSync(rootDir)) {
        throw new Error(`Cannot initialize transaction: rootDir "${rootDir}" does not exist`);
    }

    const journalDir = getJournalDir(rootDir);
    const backupsDir = path.join(journalDir, "backups");
    const stagedDir = path.join(journalDir, "staged");
    const manifestPath = path.join(journalDir, "active_tx.json");

    // Guard: check if an uncommitted transaction already exists on disk
    if (fs.existsSync(journalDir)) {
        try {
            const journalFiles = fs.readdirSync(journalDir);
            const quarantined = journalFiles.find(f => f.startsWith("active_tx.corrupt.") || f.startsWith("active_tx.invalid."));
            if (quarantined) {
                throw new Error(`Workspace has an unrecoverable corrupted journal state: Quarantined journal "${quarantined}" detected. Manual intervention required.`);
            }
        } catch (dirErr) {
            if (dirErr.message && dirErr.message.includes("unrecoverable corrupted journal state")) {
                throw dirErr;
            }
        }
    }

    if (fs.existsSync(manifestPath)) {
        let existingTx = null;
        try {
            existingTx = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch (_) {}

        if (existingTx && existingTx.status === "COMMITTED") {
            // Already committed prior transaction; cleanly remove before starting new transaction
            recoverPendingApplyTransactions(rootDir);
        } else if (existingTx && existingTx.pid && existingTx.pid !== process.pid) {
            const isStale = (Date.now() - (existingTx.updatedAt || existingTx.createdAt || 0)) > 300000;
            if (existingTx.hostname && existingTx.hostname !== os.hostname() && !isStale) {
                throw new Error(`Active transaction ${existingTx.txId} owned by different host/container "${existingTx.hostname}". Cross-host concurrent access forbidden without distributed lock.`);
            }

            let isAlive = false;
            if (!existingTx.hostname || existingTx.hostname === os.hostname()) {
                try {
                    process.kill(existingTx.pid, 0);
                    isAlive = true;
                } catch (err) {
                    isAlive = err.code === "EPERM";
                }
            }
            if (isAlive) {
                throw new Error(`Active transaction ${existingTx.txId} already held by running process ${existingTx.pid} on this workspace`);
            }
        }
        // If from a crashed dead process or stale foreign container, recover it first!
        const recResult = recoverPendingApplyTransactions(rootDir);
        if (recResult.unrecoverable) {
            throw new Error(`Workspace has an unrecoverable corrupted journal state: ${recResult.reason}`);
        }
    }

    fs.mkdirSync(backupsDir, { recursive: true });
    fs.mkdirSync(stagedDir, { recursive: true });
    syncDirectorySync(journalDir);

    const txId = crypto.randomUUID();
    const files = [];
    const uniqueRels = Array.from(new Set(targetFiles.map(f => (typeof f === "string" ? f : f.targetRelPath)).filter(Boolean)));

    for (const rel of uniqueRels) {
        const fullPath = path.resolve(rootDir, rel);
        const relHash = crypto.createHash("sha256").update(rel).digest("hex").slice(0, 16);
        const backupFileName = `${relHash}_${path.basename(rel)}.bak`;
        const stagedFileName = `${relHash}_${path.basename(rel)}.stg`;

        const backupFilePath = path.join(backupsDir, backupFileName);
        const stagedFilePath = path.join(stagedDir, stagedFileName);

        const exists = fs.existsSync(fullPath);
        let origSha256 = null;

        if (exists) {
            const buf = fs.readFileSync(fullPath);
            origSha256 = crypto.createHash("sha256").update(buf).digest("hex");
            // Durable backup copy with fsync
            const fd = fs.openSync(backupFilePath, "w");
            try {
                fs.writeSync(fd, buf);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
        }

        files.push({
            relativePath: rel.replace(/\\/g, "/"),
            absolutePath: fullPath,
            originalExists: exists,
            originalSha256: origSha256,
            backupPath: backupFilePath,
            stagedPath: stagedFilePath,
            stagedSha256: null,
            commitStatus: "PENDING"
        });
    }

    syncDirectorySync(backupsDir);

    const manifest = {
        txId,
        snapshotId,
        pid: process.pid,
        hostname: os.hostname(),
        rootDir: path.resolve(rootDir),
        status: "INITIALIZED",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files
    };

    atomicWriteJsonSync(manifestPath, manifest);
    return manifest;
}

/**
 * Stages new file content into durable staging file.
 */
export function stageDurableFile({ rootDir, tx, relativePath, content }) {
    const normRel = relativePath.replace(/\\/g, "/");
    const entry = tx.files.find(f => f.relativePath === normRel || path.resolve(rootDir, f.relativePath) === path.resolve(rootDir, relativePath));
    if (!entry) {
        throw new Error(`File "${relativePath}" is not part of transaction ${tx.txId}`);
    }

    const buf = Buffer.from(content, "utf8");
    const stagedSha = crypto.createHash("sha256").update(buf).digest("hex");

    const fd = fs.openSync(entry.stagedPath, "w");
    try {
        fs.writeSync(fd, buf);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    syncDirectorySync(path.dirname(entry.stagedPath));

    entry.stagedSha256 = stagedSha;
    tx.status = "STAGED";
    tx.updatedAt = Date.now();

    const manifestPath = path.join(getJournalDir(rootDir), "active_tx.json");
    atomicWriteJsonSync(manifestPath, tx);
}

/**
 * Atomically commits all staged files to their target locations on disk.
 * If any commit step fails, leaves durable journal in COMMITTING state for crash recovery.
 */
export function commitDurableTransaction({ rootDir, tx }) {
    const journalDir = getJournalDir(rootDir);
    const manifestPath = path.join(journalDir, "active_tx.json");

    tx.status = "COMMITTING";
    tx.updatedAt = Date.now();
    atomicWriteJsonSync(manifestPath, tx);

    for (const entry of tx.files) {
        if (!entry.stagedSha256 || !fs.existsSync(entry.stagedPath)) {
            throw new Error(`Staged file for "${entry.relativePath}" is missing or corrupt`);
        }

        const stagedContent = fs.readFileSync(entry.stagedPath);
        const targetDir = path.dirname(entry.absolutePath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            syncDirectorySync(path.dirname(targetDir));
        }

        // Write directly with fsync
        const fd = fs.openSync(entry.absolutePath, "w");
        try {
            fs.writeSync(fd, stagedContent);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        syncDirectorySync(targetDir);

        // Verify committed content matches staged sha256
        const committedSha = crypto.createHash("sha256").update(fs.readFileSync(entry.absolutePath)).digest("hex");
        if (committedSha !== entry.stagedSha256) {
            throw new Error(`Committed content for "${entry.relativePath}" checksum mismatch`);
        }

        entry.commitStatus = "COMMITTED";
        tx.updatedAt = Date.now();
        atomicWriteJsonSync(manifestPath, tx);
    }

    tx.status = "COMMITTED";
    tx.updatedAt = Date.now();
    atomicWriteJsonSync(manifestPath, tx);

    // Staged files are committed; clean staged directory
    try {
        const stagedDir = path.join(journalDir, "staged");
        if (fs.existsSync(stagedDir)) {
            fs.rmSync(stagedDir, { recursive: true, force: true });
            syncDirectorySync(journalDir);
        }
    } catch (_) {}

    return tx;
}

/**
 * Rolls back an active transaction using the durable backup copies on disk.
 */
/**
 * Cleans up journal directory completely upon successful transaction completion.
 */
export function cleanupDurableTransaction({ rootDir, tx }) {
    const journalDir = getJournalDir(rootDir);
    try {
        if (fs.existsSync(journalDir)) {
            fs.rmSync(journalDir, { recursive: true, force: true });
            syncDirectorySync(path.dirname(journalDir));
        }
    } catch (_) {}
}

export function rollbackDurableTransaction({ rootDir, tx }) {
    if (!tx || !Array.isArray(tx.files)) return;
    const journalDir = getJournalDir(rootDir);
    const manifestPath = path.join(journalDir, "active_tx.json");

    for (const entry of tx.files) {
        try {
            if (entry.originalExists && fs.existsSync(entry.backupPath)) {
                const origBuf = fs.readFileSync(entry.backupPath);
                if (entry.originalSha256) {
                    const backupSha = crypto.createHash("sha256").update(origBuf).digest("hex");
                    if (backupSha !== entry.originalSha256) {
                        console.error(`[rollbackDurableTransaction] Corrupted backup file ${entry.backupPath}! Aborting restore for this file.`);
                        continue;
                    }
                }
                const targetDir = path.dirname(entry.absolutePath);
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

                const fd = fs.openSync(entry.absolutePath, "w");
                try {
                    fs.writeSync(fd, origBuf);
                    fs.fsyncSync(fd);
                } finally {
                    fs.closeSync(fd);
                }
                syncDirectorySync(targetDir);
            } else if (!entry.originalExists && fs.existsSync(entry.absolutePath)) {
                fs.unlinkSync(entry.absolutePath);
                syncDirectorySync(path.dirname(entry.absolutePath));
            }
        } catch (rbErr) {
            console.error(`[rollbackDurableTransaction] Failed to restore file ${entry.relativePath}:`, rbErr.message);
        }
    }

    tx.status = "ROLLED_BACK";
    tx.updatedAt = Date.now();

    try {
        if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
            syncDirectorySync(journalDir);
        }
        const stagedDir = path.join(journalDir, "staged");
        if (fs.existsSync(stagedDir)) {
            fs.rmSync(stagedDir, { recursive: true, force: true });
            syncDirectorySync(journalDir);
        }
    } catch (_) {}
}

/**
 * Recovers pending or interrupted apply transactions found in .covai_journal.
 * Runs on service startup and immediately prior to any apply operation.
 * Completely idempotent: running multiple times safely converges to a restored state.
 *
 * @param {string} rootDir - Workspace root directory
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - If true, ignores PID check and forces recovery
 * @returns {Object} Recovery result status
 */
export function recoverPendingApplyTransactions(rootDir, options = {}) {
    if (!rootDir || !fs.existsSync(rootDir)) {
        return { recovered: false, reason: "Directory does not exist" };
    }

    const journalDir = getJournalDir(rootDir);
    const manifestPath = path.join(journalDir, "active_tx.json");

    if (!fs.existsSync(manifestPath)) {
        return { recovered: false, reason: "No active transaction found" };
    }

    let tx;
    try {
        tx = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (parseErr) {
        console.error("[recoverPendingApplyTransactions] Corrupted active_tx.json:", parseErr.message);
        const quarantinePath = path.join(journalDir, `active_tx.corrupt.${Date.now()}`);
        try {
            fs.renameSync(manifestPath, quarantinePath);
            syncDirectorySync(journalDir);
        } catch (_) {}
        return {
            recovered: false,
            unrecoverable: true,
            reason: `Transaction manifest was corrupt on disk (${parseErr.message}). Quarantined to ${path.basename(quarantinePath)}.`
        };
    }

    if (!tx || !Array.isArray(tx.files)) {
        const quarantinePath = path.join(journalDir, `active_tx.invalid.${Date.now()}`);
        try {
            fs.renameSync(manifestPath, quarantinePath);
            syncDirectorySync(journalDir);
        } catch (_) {}
        return {
            recovered: false,
            unrecoverable: true,
            reason: `Invalid transaction manifest format. Quarantined to ${path.basename(quarantinePath)}.`
        };
    }

    // Case 1: Transaction was already committed before crash/restart
    // Fully committed transactions have already safely updated target files on disk.
    // They are safe to clean up regardless of host/container ID or process PID.
    if (tx.status === "COMMITTED") {
        try {
            if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
            const stagedDir = path.join(journalDir, "staged");
            if (fs.existsSync(stagedDir)) fs.rmSync(stagedDir, { recursive: true, force: true });
            syncDirectorySync(journalDir);
        } catch (_) {}
        return { recovered: true, txId: tx.txId, action: "CLEANED_UP_COMMITTED", filesRestored: 0 };
    }

    // Case 1.5: Database/Filesystem Reconciliation
    // If process crashed after database transaction committed, but before COMMITTED marked on disk,
    // roll forward instead of rolling back to maintain filesystem and DB consistency!
    if (tx.status === "COMMITTING" && options.isDbCommitted) {
        tx.status = "COMMITTED";
        tx.updatedAt = Date.now();
        try {
            if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
            const stagedDir = path.join(journalDir, "staged");
            if (fs.existsSync(stagedDir)) fs.rmSync(stagedDir, { recursive: true, force: true });
            syncDirectorySync(journalDir);
        } catch (_) {}
        return {
            recovered: true,
            txId: tx.txId,
            action: "ROLLED_FORWARD_DB_ALREADY_COMMITTED",
            filesRestored: 0
        };
    }

    // Process liveness & cross-host check: If owning process is still alive and not self, do not hijack!
    if (!options.force && tx.pid && tx.pid !== process.pid) {
        const isStale = (Date.now() - (tx.updatedAt || tx.createdAt || 0)) > (options.staleTimeoutMs || 300000);
        if (tx.hostname && tx.hostname !== os.hostname()) {
            if (!isStale) {
                return {
                    recovered: false,
                    unrecoverable: true,
                    reason: `Transaction ${tx.txId} was created on different host/container "${tx.hostname}". Cross-host recovery forbidden without distributed lock.`
                };
            }
            console.warn(`[recoverPendingApplyTransactions] Stale transaction ${tx.txId} from foreign host "${tx.hostname}" (age: ${Math.round((Date.now() - (tx.updatedAt || tx.createdAt))/1000)}s) expired; proceeding with safe recovery.`);
        } else {
            let isAlive = false;
            try {
                process.kill(tx.pid, 0);
                isAlive = true;
            } catch (e) {
                isAlive = e.code === "EPERM";
            }
            if (isAlive) {
                return {
                    recovered: false,
                    reason: `Transaction ${tx.txId} is currently owned by active living process ${tx.pid}`,
                    activePid: tx.pid
                };
            }
        }
    }

    // Case 0: Unrecoverable fail-closed state
    if (tx.status === "CORRUPTED_BACKUP_FAIL_CLOSED") {
        return {
            recovered: false,
            unrecoverable: true,
            reason: "Workspace has an unrecoverable corrupted backup state. Manual intervention required."
        };
    }

    // Case 2: Transaction was INITIALIZED, STAGED, or COMMITTING when crash happened
    // Must restore all files to original backups!
    let filesRestoredCount = 0;
    let hasCorruptedBackup = false;

    for (const entry of tx.files) {
        try {
            if (entry.originalExists && fs.existsSync(entry.backupPath)) {
                const origBuf = fs.readFileSync(entry.backupPath);
                if (entry.originalSha256) {
                    const backupSha = crypto.createHash("sha256").update(origBuf).digest("hex");
                    if (backupSha !== entry.originalSha256) {
                        console.error(`[recoverPendingApplyTransactions] Corrupted backup for ${entry.relativePath}: checksum mismatch!`);
                        hasCorruptedBackup = true;
                        continue;
                    }
                }
                const targetDir = path.dirname(entry.absolutePath);
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

                const fd = fs.openSync(entry.absolutePath, "w");
                try {
                    fs.writeSync(fd, origBuf);
                    fs.fsyncSync(fd);
                } finally {
                    fs.closeSync(fd);
                }
                syncDirectorySync(targetDir);
                filesRestoredCount++;
            } else if (entry.originalExists && !fs.existsSync(entry.backupPath)) {
                console.error(`[recoverPendingApplyTransactions] Missing backup for ${entry.relativePath}!`);
                hasCorruptedBackup = true;
                continue;
            } else if (!entry.originalExists && fs.existsSync(entry.absolutePath)) {
                fs.unlinkSync(entry.absolutePath);
                syncDirectorySync(path.dirname(entry.absolutePath));
                filesRestoredCount++;
            }
        } catch (restoreErr) {
            console.error(`[recoverPendingApplyTransactions] Error restoring ${entry.relativePath}:`, restoreErr.message);
            hasCorruptedBackup = true;
        }
    }

    if (hasCorruptedBackup) {
        // Mark as unrecoverable to prevent further damage
        tx.status = "CORRUPTED_BACKUP_FAIL_CLOSED";
        tx.updatedAt = Date.now();
        atomicWriteJsonSync(manifestPath, tx);
        return {
            recovered: false,
            unrecoverable: true,
            reason: "One or more backup files failed checksum verification"
        };
    }

    // Clean up active_tx.json and staged directory
    try {
        if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
        const stagedDir = path.join(journalDir, "staged");
        if (fs.existsSync(stagedDir)) fs.rmSync(stagedDir, { recursive: true, force: true });
        syncDirectorySync(journalDir);
    } catch (_) {}

    return {
        recovered: true,
        txId: tx.txId,
        action: "ROLLED_BACK",
        previousStatus: tx.status,
        filesRestored: filesRestoredCount
    };
}
