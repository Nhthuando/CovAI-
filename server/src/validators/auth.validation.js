import { z } from "zod";

export const authValid = z.object({
  name: z
    .string()
    .min(1, "Name is required!")
    .max(100, "Name must not exceed 100 characters!"),
  email: z.email("Must be a valid email!"),
  password: z.string().min(8, "Password must be at least 8 characters!"),
});

export const loginValid = z.object({
  email: z.email("Must be a valid email!"),
  password: z.string().min(8, "Password must be at least 8 characters!"),
});


export const resetPasswordValid = z.object({
    newPassword: z.string().min(8, "Password must be at least 8 characters!")   
})