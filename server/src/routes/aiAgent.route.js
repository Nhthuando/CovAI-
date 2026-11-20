import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { AGENT_IDS, getAgentProfile, getAgentManifest, listAgentManifests } from '../agents/registry.js';

export function createAiAgentRouter({ auth = authMiddleware } = {}) {
    const router = Router();
    router.use(auth);
    router.get('/', (_req, res) => res.json({ success: true, data: listAgentManifests() }));
    router.get('/:id', (req, res) => {
        if (!AGENT_IDS.includes(req.params.id)) return res.status(404).json({ success: false, code: 'AGENT_NOT_FOUND', message: 'Agent not found' });
        return res.json({ success: true, data: { ...getAgentProfile(req.params.id), manifest: getAgentManifest(req.params.id) } });
    });
    return router;
}
export default createAiAgentRouter();
