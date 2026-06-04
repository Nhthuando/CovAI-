import { z } from "zod";

export const meValid = z.object({
  name: z
    .string()
    .min(1, "Name is required!")
    .max(100, "Name must not exceed 100 characters!")
    .optional()
    .or(z.literal("")),
  avatarUrl: z
    .string()
    .url("Must be a valid URL!")
    .optional()
    .or(z.literal("")),
});
