import { uploadZip } from "../controllers/upload.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { uploadSingleArchive } from "../middlewares/upload.middleware.js";
import express from "express";

const router = express.Router();

router.post("/upload-source", authMiddleware, uploadSingleArchive, uploadZip);

export default router;