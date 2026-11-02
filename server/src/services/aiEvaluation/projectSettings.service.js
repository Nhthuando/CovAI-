import { z } from 'zod';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { parse } from './contracts.js';
import { serial, fail } from './common.js';

const id = z.string().regex(/^[\w-]{1,128}$/);
export const environmentSchema = z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/), z.string().max(10000));
const settingsSchema = z.object({ revision: z.number().int().nonnegative(), snapshotId: id.nullable().default(null), candidateId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null), judgeConsent: z.boolean().default(false), environment: environmentSchema.default({}), removeEnvironmentNames: z.array(z.string()).max(30).default([]) }).strict();
export const storedEnvironment = row => row?.encryptedEnvironment ? JSON.parse(decrypt(row.encryptedEnvironment)) : {};
export function mergeEnvironment(current, updates = {}, removed = []) {
    const values = { ...current, ...updates };
    for (const name of removed) delete values[name];
    if (Object.keys(values).length > 30) fail('ENVIRONMENT_LIMIT', 'At most 30 project runtime variables are supported');
    if (Object.keys(values).some(name => /^(NODE_OPTIONS|NODE_PATH|PATH|LD_.*|PYTHONPATH|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NPM_CONFIG_.*|PORT|HOST)$/i.test(name))) fail('INVALID_RUNTIME_ENVIRONMENT', 'Unsupported runtime environment override');
    return values;
}
const dto = row => ({ revision: row?.revision || 0, snapshotId: row?.settings.snapshotId || null, candidateId: row?.settings.candidateId || null, judgeConsent: row?.settings.judgeConsent === true, environmentNames: row?.settings.environmentNames || [], updatedAt: row?.updatedAt || null });
export async function getProjectSettings(db, projectId) {
    return dto(await db.aiEvaluationProjectSettings.findUnique({ where: { projectId } }));
}
export async function writeProjectSettings(tx, projectId, settings, environment) {
    const data = { settings: { ...settings, environmentNames: Object.keys(environment).sort() }, encryptedEnvironment: Object.keys(environment).length ? encrypt(JSON.stringify(environment)) : null };
    return tx.aiEvaluationProjectSettings.upsert({ where: { projectId }, create: { projectId, ...data }, update: { ...data, revision: { increment: 1 } } });
}
export async function saveProjectSettings(db, projectId, input) {
    const value = parse(settingsSchema, input);
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const current = await tx.aiEvaluationProjectSettings.findUnique({ where: { projectId } });
        if ((current?.revision || 0) !== value.revision) fail('SETTINGS_CONFLICT', 'Configuration was modified in another session. Reload before saving.', 409);
        if (value.snapshotId && !await tx.projectSnapshot.findFirst({ where: { id: value.snapshotId, projectId } })) fail('SNAPSHOT_REQUIRED', 'Snapshot does not belong to this project', 404);
        const environment = mergeEnvironment(storedEnvironment(current), value.environment, value.removeEnvironmentNames);
        return dto(await writeProjectSettings(tx, projectId, { snapshotId: value.snapshotId, candidateId: value.candidateId, judgeConsent: value.judgeConsent }, environment));
    });
}
