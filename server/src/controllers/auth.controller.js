import { authValid, loginValid } from "../validators/auth.validation.js";
import {
  register as registerService,
  login as loginService,
} from "../services/auth.service.js";
import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { encrypt, decrypt } from "../utils/crypto.js";

export const register = async (req, res) => {
  try {
    const result = authValid.safeParse(req.body);
    if (!result.success)
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });

    const { name, email, password } = result.data;
    const response = await registerService(name, email, password);
    return res.status(201).json(response);
  } catch (error) {
    console.log(error);
    if (error.message === "Tài khoản đã tồn tại!") {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};

export const login = async (req, res) => {
  try {
    const result = loginValid.safeParse(req.body);
    if (!result.success)
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });

    const { email, password } = result.data;
    const response = await loginService(email, password);
    return res.status(200).json(response);
  } catch (error) {
    console.log(error);
    if (
      error.message === "Tài khoản đã tồn tại!" ||
      error.message === "Email hoặc mật khẩu không chính xác!"
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};

export const getGithubRepositories = async (req, res) => {
  try {
    // Lấy user từ DB để lấy token đã lưu (từ luồng OAuth trước đó)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { githubAccessTokenEnc: true },
    });

    if (!user || !user.githubAccessTokenEnc) {
      return res.status(401).json({
        message: "User chưa liên kết GitHub hoặc token không hợp lệ!",
      });
    }

    // Decrypt token đã mã hóa
    let accessToken;
    try {
      accessToken = decrypt(user.githubAccessTokenEnc);
    } catch {
      // Fallback: token cũ chưa encrypt
      accessToken = user.githubAccessTokenEnc;
    }

    // Sử dụng token đã giải mã để lấy repo từ GitHub API
    const response = await fetch("https://api.github.com/user/repos", {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error("Không thể lấy repository từ GitHub!");
    }

    const repos = await response.json();
    return res.status(200).json(repos);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
};

export const githubOAuthAccess = async (req, res) => {
  try {
    const { allowAccess } = req.body;

    if (allowAccess === undefined) {
      return res
        .status(400)
        .json({ message: "Thiếu thông tin cho phép truy cập!" });
    }

    if (!allowAccess) {
      // Nếu user từ chối, xóa hoặc đánh dấu là không có token
      await prisma.user.update({
        where: { id: req.user.id },
        data: { githubAccessTokenEnc: null },
      });
      return res
        .status(200)
        .json({ message: "Bạn đã từ chối cấp quyền truy cập repository!" });
    }

    // Nếu đồng ý, giữ nguyên token (giả định token đã được lưu từ luồng OAuth)
    return res
      .status(200)
      .json({ message: "Đã cấp quyền truy cập repository thành công!" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};

export const oAuthGithub = async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error === "access_denied") {
      return res.status(200).json({
        message:
          "Bạn đã từ chối cấp quyền truy cập repository riêng tư, hệ thống chỉ có thể truy cập các repository công khai!",
      });
    }

    if (!code)
      return res
        .status(400)
        .json({ message: "Không tìm thấy code từ github!" });
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code: code,
        }),
      },
    );
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    if (!accessToken)
      return res.status(400).json({ message: "Không thể lấy access token!" });
    const [userDetail, emailResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${accessToken}` } })
    ]);

    const userData = await userDetail.json();
    const emails = await emailResponse.json();

    const primaryEmail = emails.find((e) => e.primary)?.email ?? null;
    if (!primaryEmail) {
      return res.status(400).json({ message: "Không lấy được email từ GitHub!" });
    }
    let user = await prisma.user.findUnique({
      where: { email: primaryEmail },
    });
    // Encrypt access token trước khi lưu
    let encryptedToken;
    try {
      encryptedToken = encrypt(accessToken);
    } catch {
      // Fallback nếu chưa cấu hình ENCRYPTION_KEY
      encryptedToken = accessToken;
    }

    if (user) {
      user = await prisma.user.update({
        where: { email: primaryEmail },
        data: {
          githubUserId: String(userData.id),
          name: user.name || userData.login,
          githubAccessTokenEnc: encryptedToken,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          githubUserId: String(userData.id),
          name: userData.login,
          email: primaryEmail,
          githubAccessTokenEnc: encryptedToken,
        },
      });
    }
    const token = jwt.sign(
      { userId: user.id, userEmail: user.email, userName: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
    return res.status(200).json({
      message: "Đăng nhập Github thành công!",
      token,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};
