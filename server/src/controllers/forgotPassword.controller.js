import { sendEmail } from "../utils/sendEmail.js";
import prisma from "../config/prisma.js";
import crypto from "crypto";
import { resetPasswordEmailHtml } from "../utils/emailTemplate.js";
import bcrypt from "bcryptjs";
import { resetPasswordValid } from "../validators/auth.validation.js";
import logger from "../utils/logger.js";

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : email;
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, passwordResetExpires: true },
    });
    if (!user) {
      return res.status(200).json({
        message: "Password reset link has been sent, please check your email!",
      });
    }
    if (user.passwordResetExpires && user.passwordResetExpires > new Date()) {
      return res.status(429).json({
        message:
          "Please wait for previous link to expire (1 minute) before requesting again.",
      });
    }
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    const tokenExpires = new Date(Date.now() + 1 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpires: tokenExpires,
      },
      select: { id: true },
    });
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const resetUrl = `${clientUrl}/reset-password?token=${resetToken}`;
    try {
      await sendEmail({
        email: normalizedEmail,
        subject: "RESET PASSWORD | CovAI Service",
        html: resetPasswordEmailHtml(user.name, resetUrl),
      });
      return res.status(200).json({
        message: "Password reset link has been sent, please check your email!",
      });
    } catch {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: null, passwordResetExpires: null },
        select: { id: true },
      });
      return res
        .status(500)
        .json({ message: "Error sending email, please try again." });
    }
  } catch (error) {
    logger.error("[forgotPassword] Error:", error?.message || "Unknown error");
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const result = resetPasswordValid.safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });
    }
    const { newPassword } = result.data;
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const validUser = await prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!validUser) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }
    const hashedPass = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: validUser.id },
      data: {
        passwordHash: hashedPass,
        passwordResetExpires: null,
        passwordResetToken: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        refreshToken: null,
      },
      select: { id: true },
    });
    return res.status(200).json({ message: "Password reset successful!" });
  } catch (error) {
    logger.error("[resetPassword] Error:", error?.message || "Unknown error");
    return res.status(500).json({ message: "Internal server error!" });
  }
};
