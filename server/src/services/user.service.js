import prisma from "../config/prisma.js";

export const getUserById = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export const updateUserService = async (userId, updates = {}) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  // Only allow updating name and avatarUrl
  const allowedUpdates = {};
  if (updates.name !== undefined && updates.name !== "") {
    allowedUpdates.name = updates.name;
  }
  if (updates.avatarUrl !== undefined && updates.avatarUrl !== "") {
    allowedUpdates.avatarUrl = updates.avatarUrl;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: allowedUpdates,
  });

  // Return user profile without sensitive data
  return {
    id: updatedUser.id,
    name: updatedUser.name,
    email: updatedUser.email,
    avatarUrl: updatedUser.avatarUrl,
    createdAt: updatedUser.createdAt,
    updatedAt: updatedUser.updatedAt,
  };
};
