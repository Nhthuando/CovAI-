import express from "express";
import {generateAIReply,getAIReply,approveReview} from "../controllers/AIEngineController.js"
import {authMiddleware} from "../middlewares/authMiddleware.js"
import {generateLimiter} from "../middlewares/limitAIGenerate.js";

const router = express.Router();

router.post("/:reviewId/generate", authMiddleware, generateLimiter ,  generateAIReply );
router.get("/:reviewId/reply", getAIReply);
router.post("/:reviewId/approve", authMiddleware, approveReview);

export default router;