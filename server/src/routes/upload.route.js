import { uploadZip } from "../controllers/upload.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { uploadSingleArchive } from "../middlewares/upload.middleware.js";
import express from "express";
import { enforceProjectEndpointPolicy } from "../middlewares/projectEndpointPolicy.js";

const router = express.Router();

router.post("/upload-source", authMiddleware, uploadSingleArchive, enforceProjectEndpointPolicy("upload"), uploadZip);

export default router;
