import prisma from "../config/prisma.js";
import crypto from "crypto";
import { ServiceError } from "../utils/serviceError.js";

/**
 * SCRUM-280: Generate input hash
 * Takes an object or string and generates an MD5 hash.
 */
export const generateInputHash = (payload) => {
    try {
        const dataStr = typeof payload === "string" ? payload : JSON.stringify(payload);
        return crypto.createHash("md5").update(dataStr).digest("hex");
    } catch (error) {
        console.error("[AiContextCache] Error generating input hash:", error);
        throw new ServiceError("Failed to generate input hash", 500);
    }
};

/**
 * SCRUM-284: Check existing cache
 * Verifies if the cache for a given snapshot is still valid based on hash.
 */
export const checkExistingCache = async (snapshotId, currentHash) => {
    try {
        const cache = await prisma.aiContextCache.findUnique({
            where: { snapshotId }
        });
        
        if (!cache) return false;
        
        return cache.inputHash === currentHash;
    } catch (error) {
        console.error(`[AiContextCache] Error checking cache for snapshot ${snapshotId}:`, error);
        return false;
    }
};

/**
 * SCRUM-282: Reuse cached context
 * Returns the parsed payload JSON from the cache.
 */
export const reuseCachedContext = async (snapshotId) => {
    try {
        const cache = await prisma.aiContextCache.findUnique({
            where: { snapshotId }
        });
        
        if (!cache) {
            throw new ServiceError("Cache record not found", 404);
        }

        return JSON.parse(cache.payloadJson);
    } catch (error) {
        console.error(`[AiContextCache] Error reusing cached context for snapshot ${snapshotId}:`, error);
        if (error instanceof ServiceError) throw error;
        throw new ServiceError("Failed to reuse cached context", 500);
    }
};

/**
 * SCRUM-283: Save cache records
 * Upserts the cache record with the new hash and payload.
 */
export const saveCacheRecord = async (snapshotId, inputHash, payloadJson) => {
    try {
        const dataStr = typeof payloadJson === "string" ? payloadJson : JSON.stringify(payloadJson);

        const cache = await prisma.aiContextCache.upsert({
            where: { snapshotId },
            update: {
                inputHash,
                payloadJson: dataStr
            },
            create: {
                snapshotId,
                inputHash,
                payloadJson: dataStr
            }
        });
        return cache;
    } catch (error) {
        console.error(`[AiContextCache] Error saving cache for snapshot ${snapshotId}:`, error);
        throw new ServiceError("Failed to save cache record", 500);
    }
};

/**
 * SCRUM-281: Handle cache invalidation
 * Deletes the cache record if it exists.
 */
export const invalidateCache = async (snapshotId) => {
    try {
        const cache = await prisma.aiContextCache.findUnique({
            where: { snapshotId }
        });

        if (cache) {
            await prisma.aiContextCache.delete({
                where: { snapshotId }
            });
            return true;
        }
        return false;
    } catch (error) {
        console.error(`[AiContextCache] Error invalidating cache for snapshot ${snapshotId}:`, error);
        throw new ServiceError("Failed to invalidate cache", 500);
    }
};
