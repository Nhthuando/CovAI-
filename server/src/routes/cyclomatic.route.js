import { enforceProjectEndpointPolicy } from '../middlewares/projectEndpointPolicy.js';
import express from 'express';
import { calculateComplexity, getComplexity } from '../controllers/cyclomatic.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware, enforceProjectEndpointPolicy('cyclomatic'));

router.post('/calculate', authMiddleware, calculateComplexity);
router.get('/', authMiddleware, getComplexity);
router.get('/:snapshotId', authMiddleware, getComplexity);

export default router;