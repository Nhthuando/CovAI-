import { z } from "zod";

export const authValid = z.object({
  name: z
    .string()
    .min(1, "Name is required!")
    .max(100, "Name must not exceed 100 characters!"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email("Must be a valid email!")),
  password: z.string().min(8, "Password must be at least 8 characters!"),
});

export const loginValid = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email("Must be a valid email!")),
  password: z.string().min(8, "Password must be at least 8 characters!"),
});


export const resetPasswordValid = z.object({
    newPassword: z.string().min(8, "Password must be at least 8 characters!")   
})