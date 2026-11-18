import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_TTL = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

export const issueSessionTokensForUser = async (user) => {
  const accessToken = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: REFRESH_TTL },
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken },
  });

  return { accessToken, refreshToken };
};

export const register = async (name, email, password) => {
  const normalizedEmail = email.trim().toLowerCase();
  const existEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existEmail) throw new Error("Account already exists!");

  const hashedPass = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash: hashedPass, name },
  });

  const { accessToken, refreshToken } = await issueSessionTokensForUser(user);

  return {
    message: "Registration successful!",
    accessToken,
    refreshToken,
    userName: name,
    userEmail: normalizedEmail,
  };
};

export const login = async (email, password) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw new Error("Incorrect email or password!");

  const checkPass = await bcrypt.compare(password, user.passwordHash);
  if (!checkPass) throw new Error("Incorrect email or password!");

  const { accessToken, refreshToken } = await issueSessionTokensForUser(user);

  return {
    message: "Login successful!",
    accessToken,
    refreshToken,
    name: user.name,
    email: user.email,
  };
};
