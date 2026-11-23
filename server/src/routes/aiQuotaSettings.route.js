import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  getAiQuotas,
  resetAiQuotasEndpoint,
  updateAiQuotaLimitEndpoint,
} from "../controllers/aiQuotaSettings.controller.js";

const router = express.Router();

router.get("/", authMiddleware, getAiQuotas);
router.post("/reset", authMiddleware, resetAiQuotasEndpoint);
router.patch("/limit", authMiddleware, updateAiQuotaLimitEndpoint);

export default router;

