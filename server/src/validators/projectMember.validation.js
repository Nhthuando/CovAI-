import { z } from 'zod';
export const roleSchema = z.enum(['EDITOR', 'VIEWER']);
export const memberChangeSchema = z.object({ role: roleSchema, expectedRevision: z.number().int().nonnegative() }).strict();
export const invitationCreateSchema = z.object({ email: z.string().trim().email().max(254), role: roleSchema }).strict();
export const revisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const invitationTokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const pageSchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
