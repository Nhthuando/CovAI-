import fs from "fs/promises";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Dependency Installation Service
 * Validates project structure and installs dependencies using Docker.
 */
export const dependencyInstallationService = {
  /**
   * @param {Object} params
   * @param {string} params.snapshotPath - Path to the snapshot directory
   * @returns {Promise<{ success: boolean, installed: boolean, stdout: string, stderr: string }>}
   */
  install: async ({ snapshotPath }) => {
    // 1. Validate snapshot directory exists
    try {
      const stats = await fs.stat(snapshotPath);
      if (!stats.isDirectory()) {
        throw new ServiceError("Snapshot path is not a directory", 400);
      }
    } catch (error) {
      throw new ServiceError(
        `Snapshot directory not found: ${error.message}`,
        404,
      );
    }

    // 2. Validate package.json exists
    const packageJsonPath = path.join(snapshotPath, "package.json");
    try {
      await fs.access(packageJsonPath);
    } catch (error) {
      throw new ServiceError(
        "package.json not found in snapshot directory",
        400,
      );
    }

    // 3. Execute npm install inside Docker
    try {
      const result = await dockerRunner.run({
        snapshotPath,
        command: "npm install",
      });

      return {
        success: result.success,
        installed: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      // 4. Handle errors (timeout or docker failure)
      if (error instanceof ServiceError) {
        throw error;
      }
      throw new ServiceError(`Docker execution failed: ${error.message}`, 500);
    }
  },
};
