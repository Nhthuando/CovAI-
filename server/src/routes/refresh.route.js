import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!refreshToken)
    return res.status(401).json({ message: "Refresh token missing" });

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || user.refreshToken !== refreshToken || user.isSuspended) {
      return res.status(403).json({ message: user?.isSuspended ? "Account is suspended" : "Invalid refresh token" });
    }

    const accessToken = jwt.sign(
      { userId: user.id, userEmail: user.email, userName: user.name, systemRole: user.systemRole || "USER" },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    return res.status(200).json({ accessToken, refreshToken: user.refreshToken });
  } catch (error) {
    return res
      .status(403)
      .json({ message: "Invalid or expired refresh token" });
  }
});

export default router;
