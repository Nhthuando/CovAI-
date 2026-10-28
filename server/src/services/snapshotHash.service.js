import crypto from "crypto";
import fs from "fs";
import prisma from "../config/prisma.js";

/**
 * Generate SHA256 checksum for a ZIP file
 * @param {string} zipPath - Path to the ZIP file
 * @returns {Promise<string>} - SHA256 checksum hex string
 */
export const generateSnapshotHash = async (zipPath) => {
  try {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`File not found: ${zipPath}`);
    }

    const fileBuffer = fs.readFileSync(zipPath);
    const hashSum = crypto.createHash("sha256");
    hashSum.update(fileBuffer);
    const checksum = hashSum.digest("hex");

    return checksum;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`File not found: ${zipPath}`);
    }
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw new Error(`Permission denied reading file: ${zipPath}`);
    }
    throw new Error(`Failed to generate hash: ${error.message}`);
  }
};

/**
 * Find existing snapshot with same projectId and checksum
 * @param {string} projectId - Project ID
 * @param {string} checksum - SHA256 checksum
 * @returns {Promise<Object|null>} - Existing snapshot or null
 */
export const findDuplicateSnapshot = async (projectId, checksum) => {
  try {
    const existingSnapshot = await prisma.projectSnapshot.findFirst({
      where: {
        projectId,
        checksum,
      },
    });

    return existingSnapshot;
  } catch (error) {
    throw new Error(`Failed to check duplicate: ${error.message}`);
  }
};

/**
 * Generate checksum from file buffer (for in-memory uploads)
 * @param {Buffer} fileBuffer - File buffer
 * @returns {string} - SHA256 checksum hex string
 */
export const generateChecksumFromBuffer = (fileBuffer) => {
  try {
    const hashSum = crypto.createHash("sha256");
    hashSum.update(fileBuffer);
    return hashSum.digest("hex");
  } catch (error) {
    throw new Error(
      `Failed to generate checksum from buffer: ${error.message}`,
    );
  }
};

/**
 * Find existing snapshot with same projectId and checksum using buffer
 * @param {string} projectId - Project ID
 * @param {Buffer} fileBuffer - File buffer for checksum calculation
 * @returns {Promise<Object|null>} - Existing snapshot or null
 */
export const checkDuplicateWithBuffer = async (projectId, fileBuffer) => {
  try {
    const hashSum = crypto.createHash("sha256");
    hashSum.update(fileBuffer);
    const checksum = hashSum.digest("hex");

    const existingSnapshot = await prisma.projectSnapshot.findFirst({
      where: {
        projectId,
        checksum,
      },
    });

    return {
      checksum,
      existingSnapshot,
    };
  } catch (error) {
    throw new Error(`Failed to check duplicate: ${error.message}`);
  }
};
