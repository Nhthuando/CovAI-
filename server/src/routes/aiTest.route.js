import express from "express";
import { listAiTests } from "../controllers/aiTest.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, listAiTests);

export default router;