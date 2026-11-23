import { z } from "zod";
import { EMAIL_REGEX, AUTH_MESSAGES } from "../../../shared/authValidation.js";

const emailSchema = z
  .string({ error: AUTH_MESSAGES.EMAIL_REQUIRED })
  .trim()
  .min(1, AUTH_MESSAGES.EMAIL_REQUIRED)
  .toLowerCase()
  .regex(EMAIL_REGEX, AUTH_MESSAGES.EMAIL_INVALID);

export const authValid = z.object({
  name: z
    .string({ error: AUTH_MESSAGES.FULL_NAME_REQUIRED })
    .trim()
    .min(1, AUTH_MESSAGES.FULL_NAME_REQUIRED)
    .max(100, AUTH_MESSAGES.FULL_NAME_MAX_LENGTH),
  email: emailSchema,
  password: z
    .string({ error: AUTH_MESSAGES.PASSWORD_REQUIRED })
    .min(1, AUTH_MESSAGES.PASSWORD_REQUIRED)
    .min(8, AUTH_MESSAGES.PASSWORD_MIN_LENGTH),
});

export const loginValid = z.object({
  email: emailSchema,
  password: z
    .string({ error: AUTH_MESSAGES.PASSWORD_REQUIRED })
    .min(1, AUTH_MESSAGES.PASSWORD_REQUIRED),
});

export const resetPasswordValid = z.object({
  newPassword: z
    .string({ error: AUTH_MESSAGES.PASSWORD_REQUIRED })
    .min(1, AUTH_MESSAGES.PASSWORD_REQUIRED)
    .min(8, AUTH_MESSAGES.PASSWORD_MIN_LENGTH),
});

export const confirmGithubLinkValid = z.object({
  linkToken: z
    .string({ error: AUTH_MESSAGES.INVALID_LINK_TOKEN })
    .trim()
    .min(1, AUTH_MESSAGES.INVALID_LINK_TOKEN),
  password: z
    .string({ error: AUTH_MESSAGES.PASSWORD_REQUIRED })
    .min(1, AUTH_MESSAGES.PASSWORD_REQUIRED),
});

export const cancelGithubLinkValid = z.object({
  linkToken: z
    .string({ error: AUTH_MESSAGES.INVALID_LINK_TOKEN })
    .trim()
    .min(1, AUTH_MESSAGES.INVALID_LINK_TOKEN),
});
