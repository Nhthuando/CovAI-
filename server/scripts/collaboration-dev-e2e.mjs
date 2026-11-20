import 'dotenv/config';
import AdmZip from 'adm-zip';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { io } from 'socket.io-client';
import * as Y from 'yjs';
import prisma from '../src/config/prisma.js';
import { decrypt } from '../src/utils/crypto.js';

const API = process.env.COLLAB_E2E_API || 'http://localhost:5000/api';
const path = 'src/sum.js';
const sumSource = 'function sum(a, b) {\n  return a + b;\n}\nmodule.exports = { sum };\n';
const currentRun = new Date().toISOString();
const ownerLine = `// edited by owner ${currentRun}\n`;
const memberLine = `// edited by member ${currentRun}\n`;
const report = { steps: [], pass: false };
const actors = {};
const peers = [];
let baseURL;
let activeStep;
const secrets = [];

function requireThat(condition, message) {
    if (!condition) throw new Error(message);
}

function record(name, ok, detail) {
    report.steps.push({ name, ok, detail });
}

function errorDetail(error) {
    let message = error instanceof Error ? error.message : 'Unexpected error';
    for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
    return { ...error?.evidence, error: message };
}

async function step(name, operation) {
    activeStep = name;
    try {
        const detail = await operation();
        record(name, true, detail);
        return detail;
    } catch (error) {
        record(name, false, errorDetail(error));
        throw error;
    } finally {
        activeStep = undefined;
    }
}

function finish() {
    writeSync(1, `${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.pass ? 0 : 1);
}

const deadline = setTimeout(() => {
    for (const peer of peers) peer.socket.disconnect();
    record(activeStep ?? 'deadline', false, { error: 'The 240 second run deadline expired' });
    finish();
}, 240_000);

async function bounded(operation, milliseconds, message) {
    let timer;
    try {
        return await Promise.race([
            operation,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function request(endpoint, { actor, method = 'GET', data, body, headers = {} } = {}) {
    try {
        return await fetch(`${baseURL}${endpoint}`, {
            method,
            headers: {
                ...(actor ? { Authorization: `Bearer ${actors[actor].token}` } : {}),
                ...(data ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            body: data ? JSON.stringify(data) : body,
            signal: AbortSignal.timeout(45_000),
            redirect: 'error',
        });
    } catch {
        throw new Error(`${method} ${endpoint.split('?')[0]} request failed or timed out`);
    }
}

async function call(endpoint, options = {}) {
    const response = await request(endpoint, options);
    const json = await response.json().catch(() => null);
    if (!response.ok) {
        const message = [json?.message, json?.error, json?.code].filter(value => typeof value === 'string').join(' ');
        throw Object.assign(new Error(`${options.method ?? 'GET'} ${endpoint.split('?')[0]} returned HTTP ${response.status}`), {
            status: response.status,
            accountExists: [400, 409].includes(response.status) &&
                /already|exists|registered|duplicate|đã (?:tồn tại|được (?:sử dụng|đăng ký))/i.test(message),
        });
    }
    return json;
}

async function login(actor, password, { name, email }) {
    let response;
    try {
        response = await call('/auth/login', { method: 'POST', data: { email, password } });
    } catch (error) {
        if (![400, 401, 404].includes(error.status)) throw error;
        try {
            await call('/auth/register', { method: 'POST', data: { name, email, password } });
        } catch (registerError) {
            if (!registerError.accountExists) throw registerError;
        }
        response = await call('/auth/login', { method: 'POST', data: { email, password } });
    }
    requireThat(typeof response?.accessToken === 'string' && response.accessToken, 'Login did not return an access token');
    secrets.push(response.accessToken);
    actors[actor] = { name, email, token: response.accessToken };
    return { name };
}

async function seedSnapshot(projectEndpoint) {
    const list = async () => {
        const { data } = await call(`${projectEndpoint}/snapshots`, { actor: 'owner' });
        return Array.isArray(data) ? data : data?.snapshots ?? [];
    };
    let snapshots = await list();
    if (!snapshots.length) {
        const zip = new AdmZip();
        zip.addFile('package.json', Buffer.from(JSON.stringify({
            name: 'covai-demo', version: '1.0.0', scripts: { test: 'jest' },
            devDependencies: { jest: '29.7.0' },
            jest: { testEnvironment: 'node', collectCoverageFrom: ['src/**/*.js'] },
        }, null, 2)));
        zip.addFile(path, Buffer.from(sumSource));
        zip.addFile('tests/sum.test.js', Buffer.from(
            "const { sum } = require('../src/sum');\ntest('adds two values', () => expect(sum(2, 3)).toBe(5));\n",
        ));
        const form = new FormData();
        form.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'covai-demo.zip');
        await call(`${projectEndpoint}/upload-zip`, { actor: 'owner', method: 'POST', body: form });
        snapshots = await list();
    }
    const newest = snapshots.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))[0];
    requireThat(newest?.id, 'The test project has no snapshot');
    return { snapshotId: newest.id, workspaceRevision: newest.workspaceRevision ?? null };
}

async function latestDelivery(invitationId, select, remaining, payloadOnly = false) {
    return bounded(prisma.invitationDelivery.findFirst({
        where: { invitationId, ...(payloadOnly ? { encryptedPayload: { not: null } } : {}) },
        orderBy: { createdAt: 'desc' },
        select,
    }).catch(() => { throw new Error('Could not read invitation delivery from Prisma'); }),
    remaining, 'Invitation delivery query timed out');
}

async function getInvitationToken(invitationId) {
    const until = Date.now() + 3_000;
    while (Date.now() < until) {
        let row;
        try {
            row = await latestDelivery(invitationId, { encryptedPayload: true }, until - Date.now(), true);
        } catch (error) {
            if (error.message === 'Invitation delivery query timed out') break;
            throw error;
        }
        if (row?.encryptedPayload) {
            let payload;
            try {
                payload = JSON.parse(decrypt(row.encryptedPayload));
            } catch {
                break;
            }
            requireThat(payload.email === actors.member.email, 'Invitation delivery recipient did not match the fixture');
            if (typeof payload.token === 'string' && payload.token) {
                return { token: payload.token, tokenSource: 'delivery-payload' };
            }
            break;
        }
        await sleep(Math.min(100, Math.max(0, until - Date.now())));
    }
    const token = randomBytes(32).toString('hex');
    await bounded(prisma.projectInvitation.update({
        where: { id: invitationId },
        data: { tokenHash: createHash('sha256').update(token).digest('hex') },
        select: { id: true },
    }).catch(() => { throw new Error('Could not update the test invitation hash'); }),
    15_000, 'Test invitation hash update timed out');
    return { token, tokenSource: 'test-override' };
}

async function observeDelivery(invitationId) {
    const until = Date.now() + 20_000;
    const select = { status: true, attempts: true, lastErrorCode: true };
    let delivery;
    while (Date.now() < until) {
        try {
            delivery = await latestDelivery(invitationId, select, until - Date.now());
        } catch (error) {
            if (error.message === 'Invitation delivery query timed out') break;
            throw error;
        }
        if (delivery && ['SENT', 'FAILED', 'DEAD', 'CANCELED', 'CANCELLED'].includes(delivery.status)) break;
        await sleep(Math.min(250, Math.max(0, until - Date.now())));
    }
    return delivery ?? { status: null, attempts: null, lastErrorCode: null };
}

async function editorRequest(peer, event, input) {
    let result;
    try {
        result = await peer.socket.timeout(30_000).emitWithAck(event, input);
    } catch {
        throw new Error(`${peer.actor} ${event} timed out or disconnected`);
    }
    requireThat(result?.ok, `${peer.actor} ${event} was rejected`);
    return result;
}

function connectPeer(actor, projectId) {
    const socket = io(new URL('/editor', baseURL).href, {
        auth: { token: actors[actor].token }, transports: ['websocket'],
        reconnection: false, timeout: 5_000, autoConnect: false,
    });
    const peer = { actor, socket, doc: new Y.Doc(), presence: new Set(), pendingUpdates: [] };
    peers.push(peer);
    socket.on('editor:presence', event => {
        if (event.projectId !== projectId) return;
        for (const { name } of event.users ?? []) {
            if (name === actors.owner.name || name === actors.member.name) peer.presence.add(name);
        }
    });
    socket.on('editor:update', event => {
        if (!peer.documentId) peer.pendingUpdates.push(event);
        else applyPeerUpdate(peer, event);
    });
    return bounded(new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(peer));
        socket.once('connect_error', () => reject(new Error(`${actor} editor connection failed`)));
        socket.connect();
    }), 15_000, `${actor} editor connection timed out`);
}

function applyPeerUpdate(peer, event) {
    if (event.documentId !== peer.documentId || event.generation !== peer.generation) return;
    try {
        Y.applyUpdate(peer.doc, new Uint8Array(event.updateBytes), 'remote');
        peer.revision = Math.max(peer.revision, event.revision);
    } catch {
        peer.updateError = new Error(`${peer.actor} received an invalid editor update`);
    }
}

async function openPeer(peer, projectId, snapshotId) {
    const result = await editorRequest(peer, 'editor:open', { projectId, snapshotId, path, clientId: peer.doc.clientID });
    const { documentId, generation, revision, stateBytes, workspaceRevision } = result;
    requireThat(documentId && Number.isInteger(generation) && Number.isInteger(revision), 'Editor open returned invalid document metadata');
    Object.assign(peer, { documentId, generation, revision, workspaceRevision });
    Y.applyUpdate(peer.doc, new Uint8Array(stateBytes), 'remote');
    for (const event of peer.pendingUpdates) applyPeerUpdate(peer, event);
    peer.pendingUpdates = [];
    const roots = [...peer.doc.share.keys()];
    requireThat(roots.length === 1, 'Expected one shared Yjs text in src/sum.js');
    peer.text = peer.doc.getText(roots[0]);
}

async function publish(peer, change) {
    const before = Y.encodeStateVector(peer.doc);
    change(peer.text);
    const ack = await editorRequest(peer, 'editor:update', {
        documentId: peer.documentId,
        generation: peer.generation,
        requestId: randomUUID(),
        updateBytes: Y.encodeStateAsUpdate(peer.doc, before),
    });
    requireThat(Number.isInteger(ack.revision), 'Editor update returned no revision');
    peer.revision = Math.max(peer.revision, ack.revision);
    return ack.revision;
}

async function waitForPeer(peer, predicate, message) {
    const until = Date.now() + 10_000;
    do {
        if (peer.updateError) throw peer.updateError;
        if (predicate()) return;
        await sleep(25);
    } while (Date.now() < until);
    throw new Error(message);
}

async function checkpoint(name, projectEndpoint, snapshotId, owner, fallbackRevision) {
    let workspaceRevision = Number.isInteger(fallbackRevision) ? fallbackRevision : 0;
    try {
        const query = new URLSearchParams({ snapshotId });
        const status = await call(`${projectEndpoint}/editor/status?${query}`, { actor: 'owner' });
        const current = (status?.data ?? status)?.workspaceRevision;
        if (Number.isInteger(current)) workspaceRevision = current;
    } catch {
        // The checkpoint request still provides evidence if status is unavailable.
    }

    try {
        const response = await request(`${projectEndpoint}/editor/checkpoint`, {
            actor: 'owner',
            method: 'POST',
            data: {
                snapshotId,
                documents: [{ documentId: owner.documentId, generation: owner.generation, revision: owner.revision }],
                expectedWorkspaceRevision: workspaceRevision,
                requestId: randomUUID(),
            },
        });
        const json = await response.json().catch(() => null);
        const ok = response.ok && json?.ok !== false && json?.success !== false && json?.data?.ok !== false;
        record(name, ok, { ok, status: response.status });
        return { ok, workspaceRevision: (json?.data ?? json)?.workspaceRevision ?? workspaceRevision };
    } catch (error) {
        record(name, false, { ...errorDetail(error), ok: false, status: null });
        return { ok: false, workspaceRevision };
    }
}

async function cleanup() {
    await Promise.all(peers.map(async peer => {
        try {
            if (peer.socket.connected && peer.documentId) {
                await editorRequest(peer, 'editor:leave', { documentId: peer.documentId });
            }
        } catch {
            // Disconnect also clears the server-side socket membership.
        } finally {
            peer.socket.disconnect();
            peer.doc.destroy();
        }
    }));
    await bounded(prisma.$disconnect(), 10_000, 'Prisma disconnect timed out');
}

async function main() {
    let projectEndpoint;
    let snapshotId;
    let workspaceRevision;
    let owner;
    let member;
    let original;
    let editsStarted = false;

    async function restore() {
        const current = owner.text.toString();
        requireThat(
            [original, ownerLine + original, memberLine + ownerLine + original].includes(current),
            'Unexpected editor content during restoration',
        );
        if (current !== original) {
            await publish(owner, text => text.delete(0, current.length - original.length));
        }
        await waitForPeer(member, () => member.text.toString() === original, 'Member did not receive the restoration');
        requireThat(owner.text.toString() === original, 'Owner text did not match the original after restoration');
    }

    try {
        let fixture;
        await step('configuration', async () => {
            const url = new URL(API);
            requireThat(
                ['localhost', '127.0.0.1'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol) &&
                !url.username && !url.password && !url.search && !url.hash,
                'COLLAB_E2E_API must be a local HTTP(S) API URL',
            );
            baseURL = url.href.replace(/\/$/, '');
            const value = JSON.parse(readFileSync(new URL('./fixtures/collaboration-dev-accounts.example.json', import.meta.url), 'utf8'));
            requireThat(
                value.owner.email === 'collab-owner@covai.test' && value.member.email === 'collab-editor@covai.test' &&
                value.project === 'CovAI Collaboration Dev E2E' && typeof value.password === 'string' && value.password,
                'The fixture must use the dedicated dev E2E accounts and project',
            );
            secrets.push(value.password);
            fixture = value;
            return { host: url.host };
        });

        await step('ownerLogin', () => login('owner', fixture.password, fixture.owner));
        await step('memberLogin', () => login('member', fixture.password, fixture.member));

        await step('project', async () => {
            const { projects } = await call('/projects', { actor: 'owner' });
            let project = projects.find(item => item.name === fixture.project);
            if (!project) {
                const result = await call('/projects', { actor: 'owner', method: 'POST', data: {
                    name: fixture.project, description: 'Local collaboration E2E fixture',
                } });
                project = result.data;
            }
            requireThat(project?.id, 'The fixture project has no ID');
            projectEndpoint = `/projects/${project.id}`;
            const { data } = await call(`${projectEndpoint}/access`, { actor: 'owner' });
            requireThat(data?.role === 'OWNER', 'The test owner does not own the fixture project');
            return { projectId: project.id };
        });

        ({ snapshotId, workspaceRevision } = await step('snapshot', () => seedSnapshot(projectEndpoint)));

        const listMember = async () => {
            const { data } = await call(`${projectEndpoint}/members`, { actor: 'owner' });
            return data.members.find(item => item.user.email === actors.member.email);
        };
        const listInvitations = async () => {
            const { data } = await call(`${projectEndpoint}/invitations`, { actor: 'owner' });
            return data.invitations;
        };

        await step('resetMembership', async () => {
            const previous = await listMember();
            if (previous) {
                await call(`${projectEndpoint}/members/${previous.id}`, {
                    actor: 'owner', method: 'DELETE', headers: { 'If-Match': String(previous.revision) },
                });
            }
            const pending = (await listInvitations()).filter(item => item.email === actors.member.email && item.status === 'PENDING');
            for (const invitation of pending) {
                await call(`${projectEndpoint}/invitations/${invitation.id}`, {
                    actor: 'owner', method: 'DELETE', headers: { 'If-Match': String(invitation.revision) },
                });
            }
            return { removedMember: Boolean(previous), revokedInvitations: pending.length };
        });

        let invitationToken;
        const { invitationId } = await step('invite', async () => {
            const { data } = await call(`${projectEndpoint}/invitations`, {
                actor: 'owner', method: 'POST', data: { email: actors.member.email, role: 'EDITOR' },
                headers: { 'Idempotency-Key': randomUUID() },
            });
            const id = data?.invitation?.id ?? data?.id ?? (await listInvitations())
                .find(item => item.email === actors.member.email && item.status === 'PENDING')?.id;
            requireThat(id, 'The test invitation has no ID');
            const { token, tokenSource } = await getInvitationToken(id);
            secrets.push(token);
            invitationToken = token;
            return { invitationId: id, tokenSource };
        });

        for (const action of ['inspect', 'accept']) {
            await step(action, async () => {
                await call(`/invitations/${action}`, { actor: 'member', method: 'POST', data: { token: invitationToken } });
                return { invitationId };
            });
        }

        await step('memberAccess', async () => {
            const membership = await listMember();
            const { data } = await call(`${projectEndpoint}/access`, { actor: 'member' });
            requireThat(membership?.role === 'EDITOR', 'The members list did not show the test member as EDITOR');
            requireThat(data?.role === 'EDITOR' && data.features?.liveEditing === true, 'The test member did not receive live editing access');
            return { membershipRole: membership.role, role: data.role, liveEditing: data.features.liveEditing };
        });

        await step('invitationDelivery', () => observeDelivery(invitationId));

        await step('openEditors', async () => {
            const projectId = projectEndpoint.split('/').at(-1);
            [owner, member] = await Promise.all([connectPeer('owner', projectId), connectPeer('member', projectId)]);
            await openPeer(owner, projectId, snapshotId);
            await openPeer(member, projectId, snapshotId);
            requireThat(owner.documentId === member.documentId && owner.generation === member.generation &&
                owner.revision === member.revision, 'Editors did not open the same document revision');
            original = owner.text.toString();
            requireThat(member.text.toString() === original, 'The editors started with different content');
            return { documentId: owner.documentId, generation: owner.generation, revision: owner.revision, path };
        });

        await step('presence', async () => {
            await waitForPeer(member, () => member.presence.has(actors.owner.name), 'Member did not see the owner in editor presence');
            return { names: [...member.presence].sort() };
        });

        await step('realtimeOwnerToMember', async () => {
            editsStarted = true;
            const revision = await publish(owner, text => text.insert(0, ownerLine));
            await waitForPeer(member, () => member.text.toString().startsWith(ownerLine), 'Member did not receive the owner edit');
            return { revision };
        });

        const { revision } = await step('realtimeMemberToOwner', async () => {
            const revision = await publish(member, text => text.insert(0, memberLine));
            await waitForPeer(owner, () => owner.text.toString().startsWith(memberLine + ownerLine), 'Owner did not receive the member edit');
            return { revision };
        });

        for (const [line, actor] of [[1, 'member'], [2, 'owner']]) {
            const name = `lineHistory${line}`;
            await step(name, async () => {
                const query = new URLSearchParams({
                    snapshotId, documentId: owner.documentId, generation: String(owner.generation),
                    revision: String(revision), path, line: String(line),
                });
                const json = await call(`${projectEndpoint}/editor/line-history?${query}`, { actor: 'owner' });
                const { source, actorName, timestamp } = json.data ?? json;
                const detail = { line, source, actorName, timestamp };
                if (actorName !== actors[actor].name) {
                    throw Object.assign(new Error(`Line ${line} was not attributed to the ${actor}`), { evidence: detail });
                }
                return detail;
            });
        }

        ({ workspaceRevision } = await checkpoint('checkpointEdits', projectEndpoint, snapshotId, owner,
            owner.workspaceRevision ?? workspaceRevision));
    } catch (error) {
        if (!report.steps.some(entry => !entry.ok)) record('run', false, errorDetail(error));
    } finally {
        if (editsStarted) {
            try {
                await restore();
                const { ok } = await checkpoint('checkpointRestore', projectEndpoint, snapshotId, owner,
                    workspaceRevision ?? owner.workspaceRevision);
                record('restore', ok, { restored: ok, editorRestored: true });
            } catch (error) {
                record('restore', false, { ...errorDetail(error), restored: false });
            }
        }
        try {
            await cleanup();
        } catch {
            record('cleanup', false, { error: 'Prisma disconnect failed or timed out' });
        }
    }
}

try {
    await main();
    report.pass = report.steps.every(({ name, ok }) => ok || name === 'checkpointEdits');
} catch (error) {
    record('run', false, errorDetail(error));
} finally {
    clearTimeout(deadline);
    finish();
}
