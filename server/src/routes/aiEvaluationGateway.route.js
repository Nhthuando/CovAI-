import express from 'express';
import rateLimit from 'express-rate-limit';
import { gatewayRequest } from '../services/aiEvaluation/gateway.service.js';
import { safeError } from '../services/aiEvaluation/common.js';

export function createGatewayRouter({ db } = {}) {
    const router = express.Router();
    router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }));
    router.use(express.json({ limit: '128kb' }));
    for (const [endpoint, kind] of [['tool-calls', 'tool'], ['confirmation-requests', 'confirmation']]) {
        router.post(`/sessions/:sessionId/${endpoint}`, async (req, res, next) => {
            try { const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]; const result = await gatewayRequest(req.params.sessionId, token, kind, req.body, db); res.status(result.statusCode).json(result.body); }
            catch (error) { next(error); }
        });
    }
    router.use((error, _req, res, _next) => res.status(error.status || error.statusCode || 500).json({ success: false, ...safeError(error) }));
    return router;
}
export default createGatewayRouter();
