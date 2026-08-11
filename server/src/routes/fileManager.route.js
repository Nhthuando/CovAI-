import express from 'express';
import { getFileTree, readFile, saveFile, deleteFile } from '../controllers/fileManager.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/tree', authMiddleware, getFileTree);
router.post('/read', authMiddleware, readFile);
router.post('/save', authMiddleware, saveFile);
router.post('/delete', authMiddleware, deleteFile);

export default router;