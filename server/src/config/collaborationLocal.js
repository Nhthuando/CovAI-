import { assertCollaborationTestDatabase } from '../utils/collaborationDatabase.js';
export function isCollaborationLocalTest() {
    if (process.env.COLLABORATION_E2E_ENABLED !== 'true') return false;
    try {
        assertCollaborationTestDatabase(process.env.DATABASE_URL);
        return process.env.NODE_ENV !== 'production';
    } catch { return false; }
}
