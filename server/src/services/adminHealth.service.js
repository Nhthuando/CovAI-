import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../config/prisma.js";
import { recordAudit } from "./adminAudit.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, "../../.covai-temp");

/**
 * Service for Infrastructure and System Health Telemetry
 */
export class AdminHealthService {
  /**
   * Get overall system health overview
   */
  async getSystemHealthOverview() {
    const timestamp = new Date();

    // 1. PostgreSQL Health
    let postgresStatus = { status: "HEALTHY", latencyMs: 0 };
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      postgresStatus.latencyMs = Date.now() - start;
    } catch (err) {
      postgresStatus = { status: "DEGRADED", error: err.message, latencyMs: -1 };
    }

    // 2. Node.js Runtime Metrics
    const memory = process.memoryUsage();
    const runtimeMetrics = {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
        externalMb: Math.round(memory.external / (1024 * 1024)),
      },
      cpuUsage: process.cpuUsage(),
    };

    // 3. Temporary Sandbox Directory Stats (.covai-temp)
    const tempDirStats = this.inspectTempDirectory();

    return {
      status: postgresStatus.status === "HEALTHY" ? "HEALTHY" : "DEGRADED",
      timestamp,
      postgres: postgresStatus,
      runtime: runtimeMetrics,
      tempStorage: tempDirStats,
    };
  }

  /**
   * Inspect temporary runner workspace folder
   */
  inspectTempDirectory() {
    try {
      if (!fs.existsSync(TEMP_DIR)) {
        return { exists: false, totalSizeBytes: 0, totalFiles: 0, totalFolders: 0 };
      }

      let totalSizeBytes = 0;
      let totalFiles = 0;
      let totalFolders = 0;

      const entries = fs.readdirSync(TEMP_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          totalFolders++;
          const subPath = path.join(TEMP_DIR, entry.name);
          try {
            const subEntries = fs.readdirSync(subPath);
            totalFiles += subEntries.length;
          } catch {
            // ignore
          }
        } else {
          totalFiles++;
          try {
            const stat = fs.statSync(path.join(TEMP_DIR, entry.name));
            totalSizeBytes += stat.size;
          } catch {
            // ignore
          }
        }
      }

      return {
        exists: true,
        totalSizeBytes,
        totalSizeMb: (totalSizeBytes / (1024 * 1024)).toFixed(2),
        totalFiles,
        totalFolders,
      };
    } catch (err) {
      return { exists: false, error: err.message, totalSizeBytes: 0, totalFiles: 0, totalFolders: 0 };
    }
  }

  /**
   * Clean up old temporary files older than maxAgeHours (default: 2 hours)
   */
  async cleanupTempDirectory({ maxAgeHours = 2, user, req } = {}) {
    if (!fs.existsSync(TEMP_DIR)) {
      return { cleanedFolders: 0, maxAgeHours };
    }

    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedFolders = 0;

    // Scan target directories: direct temp files and items under collaboration-operations
    const targets = [];
    const directEntries = fs.readdirSync(TEMP_DIR, { withFileTypes: true });

    for (const entry of directEntries) {
      const entryPath = path.join(TEMP_DIR, entry.name);
      if (entry.isDirectory() && entry.name === "collaboration-operations") {
        try {
          const subEntries = fs.readdirSync(entryPath, { withFileTypes: true });
          for (const sub of subEntries) {
            targets.push(path.join(entryPath, sub.name));
          }
        } catch (e) {
          // ignore
        }
      } else {
        targets.push(entryPath);
      }
    }

    // Limit to max 20 deletions per run to keep latency low
    for (const targetPath of targets.slice(0, 20)) {
      try {
        const stat = await fs.promises.stat(targetPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.rm(targetPath, { recursive: true, force: true, maxRetries: 1 });
          cleanedFolders++;
        }
      } catch (err) {
        console.warn(`[AdminHealthService] Error cleaning ${targetPath}:`, err.message);
      }
    }

    await recordAudit({
      actorId: user?.id || null,
      action: "CLEANUP_TEMP_FILES",
      targetModel: "SystemHealth",
      targetId: "covai-temp",
      afterSnapshot: { cleanedFolders, maxAgeHours },
      req,
    });

    return {
      cleanedFolders,
      maxAgeHours,
    };
  }
}

export const adminHealthService = new AdminHealthService();
