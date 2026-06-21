import express from 'express';
import { getFiles } from '../controllers/file.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js'; // Import middleware

const router = express.Router();

// Thêm authMiddleware vào giữa đường dẫn và controller
// Request sẽ đi qua authMiddleware trước, nếu hợp lệ mới tới getFiles
router.get('/files', authMiddleware, getFiles);

export default router;
