import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import { setRefreshTokenCookie } from "../controllers/auth.controller.js";
import {
  isStoredRefreshTokenValid,
  issueSessionTokensForUser,
} from "../services/auth.service.js";

const router = express.Router();
const SLIDING_RENEW_THRESHOLD_SEC = 7 * 24 * 60 * 60; // renew refresh token if < 7 days remaining

router.post("/", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ code: "REFRESH_TOKEN_MISSING", message: "Refresh token missing" });
  }

  let payload;
  try {
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    payload = jwt.verify(refreshToken, refreshSecret);
  } catch (error) {
    console.warn("[refresh] JWT verify failed:", error?.message || error);
    return res.status(403).json({ code: "REFRESH_TOKEN_INVALID", message: "Invalid or expired refresh token" });
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, refreshToken: true },
    });
  } catch (dbError) {
    console.error("[refresh] Transient DB error verifying refresh token:", dbError?.message || dbError);
    return res.status(503).json({ code: "REFRESH_UNAVAILABLE", message: "Session renewal temporarily unavailable" });
  }

  if (!user || !isStoredRefreshTokenValid(user.refreshToken, refreshToken)) {
    return res.status(403).json({ code: "REFRESH_TOKEN_INVALID", message: "Invalid refresh token" });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const remainingSec = typeof payload.exp === "number" ? payload.exp - nowSec : 0;

  // Slide refresh token expiry forward when approaching threshold so active users stay signed in
  if (remainingSec < SLIDING_RENEW_THRESHOLD_SEC) {
    try {
      const issued = await issueSessionTokensForUser(user);
      setRefreshTokenCookie(req, res, issued.refreshToken);
      return res.status(200).json({ accessToken: issued.accessToken });
    } catch (err) {
      console.error("[refresh] Sliding renewal failed, issuing access token only:", err?.message || err);
    }
  }

  const accessToken = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" },
  );
  setRefreshTokenCookie(req, res, refreshToken);
  return res.status(200).json({ accessToken });
});

export default router;
