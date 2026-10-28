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
    jobTitle: user.jobTitle,
    bio: user.bio,
    githubUserId: user.githubUserId || null,
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

  const allowedUpdates = {};
  if (updates.name !== undefined) {
    allowedUpdates.name = updates.name;
  }
  if (updates.avatarUrl !== undefined) {
    allowedUpdates.avatarUrl = updates.avatarUrl;
  }
  if (updates.jobTitle !== undefined) {
    allowedUpdates.jobTitle = updates.jobTitle;
  }
  if (updates.bio !== undefined) {
    allowedUpdates.bio = updates.bio;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: allowedUpdates,
  });

  return {
    id: updatedUser.id,
    name: updatedUser.name,
    email: updatedUser.email,
    avatarUrl: updatedUser.avatarUrl,
    jobTitle: updatedUser.jobTitle,
    bio: updatedUser.bio,
    createdAt: updatedUser.createdAt,
    updatedAt: updatedUser.updatedAt,
  };
};
