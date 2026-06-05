import { authValid, loginValid } from "../validators/auth.validation.js";
import {
  register as registerService,
  login as loginService,
} from "../services/auth.service.js";
import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import crypto from "crypto"

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

export const oAuthGithub = async (req,res) => {
    try {
      const {code} = req.query;
      if(!code) return res.status(400).json({message: "Không tìm thấy code từ github!"});
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json' 
            },
            body: JSON.stringify({
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code: code
            })
        });
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        if(!accessToken) return res.status(400).json({message: "Không thể lấy access token!"});
        const userDetail = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userData = await userDetail.json();
        const emailResponse = await fetch('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const emails = await emailResponse.json();
        const primaryEmail = emails.find(e => e.primary)?.email ?? null;
        if (!primaryEmail) return res.status(400).json({ message: "Không lấy được email từ GitHub!" });     
        let user = await prisma.user.findUnique({
            where: { email: primaryEmail }
        });
        if (user) {
            user = await prisma.user.update({
                where: { email: primaryEmail },
                data: {
                    githubUserId: String(userData.id),
                    name: user.name || userData.login, 
                    githubAccessTokenEnc: accessToken, 
                }
            });
        } else {
            user = await prisma.user.create({
                data: {
                    githubUserId: String(userData.id),
                    name: userData.login,
                    email: primaryEmail,
                    githubAccessTokenEnc: accessToken
                }
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
      return res.status(500).json({message: "Có lỗi server!"});
    }
}