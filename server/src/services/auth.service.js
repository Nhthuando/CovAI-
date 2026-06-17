import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export const register = async (name, email, password) => {
  const existEmail = await prisma.user.findUnique({ where: { email } });
  if (existEmail) throw new Error("Tài khoản đã tồn tại!");

  const hashedPass = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash: hashedPass, name },
  });

  const token = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  return {
    message: "Đăng ký thành công!",
    token,
    userName: name,
    userEmail: email,
  };
};

export const login = async (email, password) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Email hoặc mật khẩu không chính xác!");

  const checkPass = await bcrypt.compare(password, user.passwordHash);
  if (!checkPass) throw new Error("Email hoặc mật khẩu không chính xác!");

  const token = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  return {
    message: "Đăng nhập thành công!",
    token,
    name: user.name,
    email: user.email,
  };
};
