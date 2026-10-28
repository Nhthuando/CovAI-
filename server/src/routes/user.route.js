import express from "express";
import { me, update } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/me", authMiddleware, me);
router.patch("/me", authMiddleware, update);

export default router;
