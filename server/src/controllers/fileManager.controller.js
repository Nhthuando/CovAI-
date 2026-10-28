import { getProjectTree } from '../services/project.service.js';
import { readVersionedProjectFile } from '../services/projectFileVersion.service.js';
import { mutateProjectWorkspace } from '../services/projectMutation.service.js';
import { ServiceError } from '../utils/serviceError.js';

const endpoint = action => async (req, res) => {
    try {
        const input = { ...req.query, ...req.body };
        if (input.filePath !== undefined || input.rootDir !== undefined) throw new ServiceError('Host paths are no longer accepted; use projectId, snapshotId and a project-relative path.', 400);
        const result = await action({ ...input, userId: req.user.id });
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, code: error.code, message: error.statusCode ? error.message : 'File operation failed', details: error.details });
    }
};
export const getFileTree = endpoint(input => getProjectTree(input.projectId, input.userId, { snapshotId: input.snapshotId, withMetadata: true }));
export const readFile = endpoint(input => readVersionedProjectFile(input));
export const saveFile = endpoint(input => mutateProjectWorkspace({ ...input, kind: 'WRITE_FILE' }));
export const deleteFile = endpoint(input => mutateProjectWorkspace({ ...input, kind: 'DELETE_ENTRY' }));
