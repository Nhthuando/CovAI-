import { z } from 'zod';
import { DISCIPLINE_ROLES } from '../../../shared/projectRoles.js';
export const roleSchema = z.enum(['EDITOR', 'VIEWER']);
const disciplineSchema = z.enum(DISCIPLINE_ROLES).nullable();
export const memberChangeSchema = z.object({ role: roleSchema.optional(), disciplineRole: disciplineSchema.optional(), expectedRevision: z.number().int().nonnegative() }).strict().refine(value => value.role !== undefined || value.disciplineRole !== undefined, 'Choose a role or access change');
export const invitationCreateSchema = z.object({ email: z.string().trim().email().max(254), role: roleSchema, disciplineRole: disciplineSchema.optional().default(null) }).strict();
export const revisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const invitationTokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const pageSchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
