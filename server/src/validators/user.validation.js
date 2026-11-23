import { z } from "zod";

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export const meValid = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required!")
    .max(100, "Name must not exceed 100 characters!")
    .optional(),
  avatarUrl: z
    .string()
    .url("Must be a valid URL!")
    .refine(
      (val) => {
        if (!val || !val.startsWith("data:")) return true;
        const base64Part = val.split(",")[1] || "";
        const sizeInBytes = Math.round((base64Part.length * 3) / 4);
        return sizeInBytes <= MAX_AVATAR_SIZE_BYTES;
      },
      {
        message: "Avatar image size must not exceed 2MB!",
      },
    )
    .optional()
    .or(z.literal("")),
  jobTitle: z
    .string()
    .max(100, "Job title must not exceed 100 characters!")
    .optional()
    .or(z.literal("")),
  bio: z
    .string()
    .max(500, "Bio must not exceed 500 characters!")
    .optional()
    .or(z.literal("")),
});
