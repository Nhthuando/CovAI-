import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  getPortfolioOverviewController,
  batchRunSuitesController,
  compareProjectsController,
  exportPortfolioReportController,
} from "../controllers/portfolio.controller.js";

const router = express.Router();
router.use(authMiddleware);

router.get("/overview", getPortfolioOverviewController);
router.post("/batch-run", batchRunSuitesController);
router.get("/compare", compareProjectsController);
router.get("/export", exportPortfolioReportController);
router.post("/export", exportPortfolioReportController);

export default router;

