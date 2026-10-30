import prisma from '../../config/prisma.js';
import { hash, same, serial, fail, getPointer, redact, requireEnabled } from './common.js';
import { parse, callSchema, confirmationSchema } from './contracts.js';
import { executeMock } from './mockRuntime.service.js';

const include = { caseResult: { include: { testCase: true, run: { include: { profileVersion: true } } } }, calls: { orderBy: { sequence: 'asc' } }, grants: { orderBy: { sequence: 'asc' } } };
export async function gatewayRequest(sessionId, token, kind, input, db = prisma) {
    requireEnabled();
    if (process.env.AI_EVALUATION_ACTION_ENABLED !== 'true') fail('ACTION_DISABLED', 'Action evaluation is disabled', 503);
    if (typeof token !== 'string' || token.length < 32 || token.length > 256) fail('INVALID_GATEWAY_TOKEN', 'Invalid session token', 401);
    const data = parse(kind === 'tool' ? callSchema : confirmationSchema, input);
    return serial(db, async tx => {
        const first = await tx.aiEvaluationAttempt.findUnique({ where: { id: sessionId }, include: { caseResult: true } });
        if (!first || first.tokenHash !== hash(token)) fail('INVALID_GATEWAY_TOKEN', 'Invalid session token', 401);
        await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${first.caseResult.runId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AiEvaluationAttempt" WHERE id = ${sessionId} FOR UPDATE`;
        const attempt = await tx.aiEvaluationAttempt.findUnique({ where: { id: sessionId }, include });
        const run = attempt.caseResult.run;
        if (attempt.gatewayState !== 'OPEN' || run.executionStatus !== 'RUNNING' || !attempt.expiresAt || attempt.expiresAt <= new Date()) fail('SESSION_CLOSED', 'This evaluation session is closed or expired', 410);
        const definition = run.profileVersion.definition;
        const tool = definition.tools.find(t => t.name === data.toolName);
        const fingerprint = hash({ toolName: data.toolName, arguments: data.arguments });
        const sequence = attempt.sequence + 1;
        const violation = async code => {
            const payload = redact({ code, toolName: data.toolName, arguments: data.arguments }, [token]);
            await tx.aiEvaluationEvidence.create({ data: { runId: run.id, caseResultId: attempt.caseResultId, attemptId: attempt.id, kind: 'GATEWAY_VIOLATION', provenance: 'COVAI_OBSERVED', availability: 'AVAILABLE', completeness: 'COMPLETE', payload, contentHash: hash(payload) } });
            return { statusCode: 409, body: { status: code } };
        };
        if (kind === 'confirmation') {
            const old = attempt.grants.find(g => g.requestId === data.requestId);
            if (old) return old.fingerprint === fingerprint && old.prompt === data.prompt ? { statusCode: 200, body: { decision: old.decision, grantId: old.decision === 'APPROVED' ? old.id : null } } : violation('CONFIRMATION_REPLAY_CONFLICT');
            if (attempt.grants.length >= 20) return violation('CONFIRMATION_LIMIT');
            const script = attempt.caseResult.testCase.definition.confirmationScript[attempt.grants.length];
            const decision = tool && !tool.forbidden && script && script.toolName === data.toolName && same(script.arguments, data.arguments) ? script.decision : 'DENIED';
            const grant = await tx.aiEvaluationConfirmationGrant.create({ data: { attemptId: attempt.id, requestId: data.requestId, fingerprint, prompt: redact(data.prompt, [token]), decision, sequence, expiresAt: attempt.expiresAt } });
            await tx.aiEvaluationAttempt.update({ where: { id: attempt.id }, data: { sequence } });
            return { statusCode: 200, body: { decision, grantId: decision === 'APPROVED' ? grant.id : null } };
        }
        const payloadHash = hash(data);
        const old = attempt.calls.find(call => call.callId === data.callId);
        if (old) return old.payloadHash === payloadHash ? { statusCode: 200, body: { status: old.status, result: old.result, replayed: true } } : violation('CALL_REPLAY_CONFLICT');
        if (attempt.callbackCount >= definition.limits.maxToolCalls) return violation('TOOL_LIMIT');
        const businessKey = tool?.duplicateKey.length ? hash({ tool: tool.name, values: tool.duplicateKey.map(p => getPointer(data.arguments, p) ?? null) }) : null;
        let status;
        let result;
        let state = attempt.state;
        const grant = data.confirmationGrantId ? attempt.grants.find(g => g.id === data.confirmationGrantId) : null;
        if (!tool) status = 'UNKNOWN_TOOL';
        else if (tool.forbidden) status = 'FORBIDDEN';
        else if (businessKey && attempt.calls.some(c => c.businessKey === businessKey && c.status === 'EXECUTED')) status = 'DUPLICATE';
        else if (tool.requiresConfirmation && (!grant || grant.fingerprint !== fingerprint || grant.decision !== 'APPROVED' || grant.consumedAt || grant.expiresAt <= new Date())) status = 'CONFIRMATION_REQUIRED';
        else {
            ({ status, result, state } = executeMock(tool, data.arguments, attempt.state));
            if (tool.requiresConfirmation && status === 'EXECUTED') await tx.aiEvaluationConfirmationGrant.update({ where: { id: grant.id }, data: { consumedAt: new Date() } });
        }
        result = redact(result ?? { error: status }, [token]);
        await tx.aiEvaluationToolCall.create({ data: { attemptId: attempt.id, callId: data.callId, payloadHash, businessKey, sequence, toolName: data.toolName, arguments: redact(data.arguments, [token]), status, result } });
        await tx.aiEvaluationAttempt.update({ where: { id: attempt.id }, data: { state: redact(state, [token]), sequence, callbackCount: { increment: 1 } } });
        return { statusCode: 200, body: { status, result } };
    });
}

export async function closeGateway(db, attemptId, status = 'COMPLETED') {
    return serial(db, async tx => {
        const attempt = await tx.aiEvaluationAttempt.findUnique({ where: { id: attemptId }, include: { caseResult: true } });
        if (!attempt) return;
        await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${attempt.caseResult.runId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AiEvaluationAttempt" WHERE id = ${attemptId} FOR UPDATE`;
        const run = await tx.aiEvaluationRun.findUnique({ where: { id: attempt.caseResult.runId } });
        if (run.executionStatus !== 'RUNNING') return tx.aiEvaluationAttempt.findUnique({ where: { id: attemptId }, include: { calls: { orderBy: { sequence: 'asc' } }, grants: { orderBy: { sequence: 'asc' } } } });
        return tx.aiEvaluationAttempt.update({ where: { id: attemptId }, data: { gatewayState: 'CLOSED', tokenHash: null, status, finishedAt: new Date() }, include: { calls: { orderBy: { sequence: 'asc' } }, grants: { orderBy: { sequence: 'asc' } } } });
    });
}
