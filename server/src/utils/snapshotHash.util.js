/**
 * @file snapshotHash.util.js
 * @description Utility to calculate a stable snapshot hash.
 */

/**
 * Calculates a stable hash for a snapshot based on checksum or commit SHA.
 * @param {Object} snapshot - The snapshot object.
 * @param {string} [snapshot.checksum] - The checksum of the snapshot.
 * @param {string} [snapshot.commitSha] - The commit SHA of the snapshot.
 * @returns {string|null} - The calculated hash or null if none available.
 */
export const calculateSnapshotHash = (snapshot) => {
  if (snapshot.checksum) {
    return snapshot.checksum;
  }
  if (snapshot.commitSha) {
    return snapshot.commitSha;
  }
  return null;
};
