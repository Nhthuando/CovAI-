import { ServiceError } from "../utils/serviceError.js";
import { listOwnedSnapshotSourceFiles, rejectLegacyRootDir } from "../services/projectSourceFiles.service.js";

/** GET /api/files?projectId=...&snapshotId=... */
export const getFiles = async (req, res) => {
  try {
    rejectLegacyRootDir(req.query);
    const { projectId, snapshotId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ success: false, message: "projectId is required" });
    }
    const data = await listOwnedSnapshotSourceFiles({ projectId, snapshotId, userId: req.user.id });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error(error);
    return res.status(500).json({ success: false, message: "Failed to list source files" });
  }
};
