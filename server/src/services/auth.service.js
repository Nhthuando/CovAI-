import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_TTL = "15m";

export const register = async (name, email, password) => {
  const existEmail = await prisma.user.findUnique({ where: { email } });
  if (existEmail) throw new Error("Account already exists!");

  const hashedPass = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash: hashedPass, name },
  });

  const accessToken = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET,
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
    userEmail: email,
  };
};

export const login = async (email, password) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Incorrect email or password!");

  const checkPass = await bcrypt.compare(password, user.passwordHash);
  if (!checkPass) throw new Error("Incorrect email or password!");

  const accessToken = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET,
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
  };
};
