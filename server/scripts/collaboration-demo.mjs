import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { assertCollaborationTestDatabase } from '../src/tests/helpers/collaborationDb.js';

assertCollaborationTestDatabase(process.env.DATABASE_URL);
if (process.env.COLLABORATION_E2E_ENABLED !== 'true') throw new Error('Demo requires the isolated collaboration test profile');
const API = 'http://127.0.0.1:55000/api';
const SMTP = 'http://127.0.0.1:58025';
const password = 'Collaboration-local-123!';
const actors = {};
async function call(endpoint, { actor, method = 'GET', data, body, headers = {} } = {}) {
    const response = await fetch(`${API}${endpoint}`, {
        method, headers: { ...(actor ? { Authorization: `Bearer ${actors[actor].token}` } : {}),
            ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: data ? JSON.stringify(data) : body,
    });
    const json = await response.json();
    if (!response.ok) throw Object.assign(new Error(json.message || json.error || `HTTP ${response.status}`), { status: response.status });
    return json;
}
for (const actor of ['owner', 'editor', 'viewer', 'outsider']) {
    const email = `${actor}@covai.test`;
    try { await call('/auth/register', { method: 'POST', data: { name: `Demo ${actor}`, email, password } }); }
    catch (error) { if (error.status !== 400) throw error; }
    const login = await call('/auth/login', { method: 'POST', data: { email, password } });
    actors[actor] = { email, token: login.accessToken };
}
const name = 'CovAI Collaboration Demo';
let project = (await call('/projects', { actor: 'owner' })).projects.find(item => item.name === name);
if (!project) project = (await call('/projects', { actor: 'owner', method: 'POST', data: { name, description: 'Local collaboration demo with real membership and API, shared AI fixture transport.' } })).data;
for (const [actor, role] of [['editor', 'EDITOR'], ['viewer', 'VIEWER']]) {
    const members = (await call(`/projects/${project.id}/members`, { actor: 'owner' })).data.members;
    if (members.some(member => member.user.email === actors[actor].email)) continue;
    const pending = (await call(`/projects/${project.id}/invitations`, { actor: 'owner' })).data.invitations.find(invite => invite.email === actors[actor].email);
    if (pending) await call(`/projects/${project.id}/invitations/${pending.id}/resend`, { actor: 'owner', method: 'POST', data: { expectedRevision: pending.revision } });
    else await call(`/projects/${project.id}/invitations`, { actor: 'owner', method: 'POST', data: { email: actors[actor].email, role }, headers: { 'Idempotency-Key': randomUUID() } });
    let accepted = false;
    for (let attempt = 0; attempt < 40 && !accepted; attempt++) {
        const messages = await (await fetch(`${SMTP}/api/v1/messages`)).json();
        const message = messages.messages.find(item => item.To?.some(to => to.Address === actors[actor].email));
        if (message) {
            const content = await (await fetch(`${SMTP}/api/v1/message/${message.ID}`)).json();
            const token = content.Text?.match(/\/invitations\/([a-f0-9]{64})/)?.[1];
            if (token) {
                try { await call('/invitations/accept', { actor, method: 'POST', data: { token } }); accepted = true; }
                catch (error) { if (![404, 409, 410].includes(error.status)) throw error; }
            }
        }
        if (!accepted) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!accepted) throw new Error(`Demo invitation was not delivered for ${actor}`);
}
const snapshots = (await call(`/projects/${project.id}/snapshots`, { actor: 'owner' })).data;
const rows = Array.isArray(snapshots) ? snapshots : snapshots?.snapshots || [];
if (!rows.length) {
    const zip = new AdmZip();
    zip.addFile('package.json', Buffer.from(JSON.stringify({ name: 'covai-demo', version: '1.0.0', scripts: { test: 'jest' },
        devDependencies: { jest: '29.7.0' }, jest: { testEnvironment: 'node', collectCoverageFrom: ['src/**/*.js'] } }, null, 2)));
    zip.addFile('src/sum.js', Buffer.from('function sum(a, b) { return a + b; }\nmodule.exports = { sum };\n'));
    zip.addFile('tests/sum.test.js', Buffer.from("const { sum } = require('../src/sum');\ntest('adds two values', () => expect(sum(2, 3)).toBe(5));\n"));
    const form = new FormData();
    form.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'covai-demo.zip');
    await call(`/projects/${project.id}/upload-zip`, { actor: 'owner', method: 'POST', body: form });
}
console.log(JSON.stringify({ frontend: 'http://127.0.0.1:55173', projectUrl: `http://127.0.0.1:55173/main-editor?projectId=${project.id}&tab=settings&setting=members`,
    demoEmails: Object.values(actors).map(actor => actor.email), aiMode: 'LOCAL AI FIXTURE', note: 'Demo password is documented in the localhost runbook; no tokens are printed.' }, null, 2));
