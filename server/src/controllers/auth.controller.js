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
    res.cookie("refreshToken", response.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.status(201).json({
      message: response.message,
      accessToken: response.accessToken,
      userName: response.userName,
      userEmail: response.userEmail,
    });
  } catch (error) {
    console.log(error);
    if (error.message === "Account already exists!") {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Internal server error!" });
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
    res.cookie("refreshToken", response.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.status(200).json({
      message: response.message,
      accessToken: response.accessToken,
      name: response.name,
      email: response.email,
    });
  } catch (error) {
    console.log(error);
    if (
      error.message === "Account already exists!" ||
      error.message === "Incorrect email or password!"
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const getGithubRepositories = async (req, res) => {
  try {
    // Get user from DB to retrieve stored token (from previous OAuth flow)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { githubAccessTokenEnc: true },
    });

    if (!user || !user.githubAccessTokenEnc) {
      return res.status(401).json({
        message: "User has not linked GitHub or token is invalid!",
      });
    }

    // Decrypt encrypted token
    let accessToken;
    try {
      accessToken = decrypt(user.githubAccessTokenEnc);
    } catch {
      // Fallback: legacy unencrypted token
      accessToken = user.githubAccessTokenEnc;
    }

    // Use decrypted token to fetch repos from GitHub API
    let repos = [];
    let page = 1;
    const perPage = 15;

    while (true) {
      const response = await fetch(
        `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=created&direction=desc`,
        {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Unable to fetch repositories from GitHub!");
      }

      const pageRepos = await response.json();
      if (pageRepos.length === 0) break;

      repos = repos.concat(pageRepos);
      if (pageRepos.length < perPage) break;
      page++;
    }

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
        .json({ message: "Missing permission parameter!" });
    }

    if (!allowAccess) {
      // If user declined, clear token
      await prisma.user.update({
        where: { id: req.user.id },
        data: { githubAccessTokenEnc: null },
      });
      return res
        .status(200)
        .json({ message: "You declined repository access permission!" });
    }

    // If approved, keep token (assumes saved during OAuth)
    return res
      .status(200)
      .json({ message: "Repository access granted successfully!" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const oAuthGithub = async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error === "access_denied") {
      return res.status(200).json({
        message:
          "You declined private repository access; system can only access public repositories!",
      });
    }

    if (!code)
      return res
        .status(400)
        .json({ message: "Code parameter not found from GitHub!" });
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
      return res.status(400).json({ message: "Unable to retrieve access token!" });
    const [userDetail, emailResponse] = await Promise.all([
      fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    const userData = await userDetail.json();
    const emails = await emailResponse.json();

    const primaryEmail = emails.find((e) => e.primary)?.email ?? null;
    if (!primaryEmail) {
      return res
        .status(400)
        .json({ message: "Unable to retrieve email from GitHub!" });
    }
    let user = await prisma.user.findUnique({
      where: { email: primaryEmail },
    });
    // Encrypt access token before storing
    let encryptedToken;
    try {
      encryptedToken = encrypt(accessToken);
    } catch {
      // Fallback if ENCRYPTION_KEY is not configured
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
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );
    return res.status(200).json({
      message: "GitHub login successful!",
      token,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};
