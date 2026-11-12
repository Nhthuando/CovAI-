import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_TTL = process.env.JWT_EXPIRES_IN || "7d";

export const register = async (name, email, password) => {
  const normalizedEmail = email.trim().toLowerCase();
  const existEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existEmail) throw new Error("Account already exists!");

  const hashedPass = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash: hashedPass, name },
  });

  const accessToken = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name, systemRole: user.systemRole || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken },
  });

  return {
    message: "Registration successful!",
    accessToken,
    refreshToken,
    userName: name,
    userEmail: normalizedEmail,
    systemRole: user.systemRole || "USER",
  };
};

export const login = async (email, password) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw new Error("Incorrect email or password!");

  if (user.isSuspended) {
    throw new Error("Account has been suspended! Please contact support.");
  }

  const checkPass = await bcrypt.compare(password, user.passwordHash);
  if (!checkPass) throw new Error("Incorrect email or password!");

  const accessToken = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name, systemRole: user.systemRole || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken },
  });

  return {
    message: "Login successful!",
    accessToken,
    refreshToken,
    name: user.name,
    email: user.email,
    systemRole: user.systemRole || "USER",
  };
};
