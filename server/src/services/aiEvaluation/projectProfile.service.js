import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeDiskPath, resolveSnapshotFile, snapshotWorkspaceRoot } from '../../utils/snapshotWorkspace.js';
import { CHATBOT_PROFILE, fail, hash } from './common.js';
import { analyzeChatbotWorkspace, maskSecretsInText, resolveProjectSnapshot } from './designAudit.service.js';
import { saveKnowledge } from './knowledge.service.js';

const DESCRIPTION_LIMIT = 5000;
const README_LIMIT = 6000;
const PROMPT_FILE_LIMIT = 20 * 1024;
const PROFILE_LIMIT = 30000;

function readmeExcerpt(readme, limit = README_LIMIT) {
    const text = readme.trim();
    if (limit <= 0) return '';
    if (text.length <= limit) return text;
    const prefix = text.slice(0, limit + 1);
    return text.slice(0, Math.max(0, prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r'))).trimEnd();
}

export function buildChatbotProfile({ projectName, description = '', packageDescription = '', prompts = [], readme = '' }) {
    const name = maskSecretsInText(projectName).trim();
    const sections = name ? [`# Chatbot profile: ${name}`] : [];
    const purpose = [description, packageDescription]
        .map(value => maskSecretsInText(value, [], DESCRIPTION_LIMIT).trim())
        .filter(Boolean);
    if (purpose.length) sections.push(`## What the chatbot is for\n\n${purpose.join('\n\n')}`);

    const promptSections = [];
    for (const { file, text } of prompts) {
        const masked = maskSecretsInText(text).trim();
        if (masked) promptSections.push(`### ${maskSecretsInText(file)}\n\n${masked}`);
    }
    if (promptSections.length) sections.push(`## System prompt\n\n${promptSections.join('\n\n')}`);

    const content = sections.join('\n\n');
    const readmeHeading = (content ? '\n\n' : '') + '## Project README\n\n';
    const readmeBudget = Math.min(README_LIMIT, PROFILE_LIMIT - content.length - readmeHeading.length);
    const overview = readmeExcerpt(maskSecretsInText(readmeExcerpt(readme), [], Infinity), readmeBudget);
    return overview ? content + readmeHeading + overview : content.slice(0, PROFILE_LIMIT).trimEnd();
}

async function readOptional(file, read) {
    try {
        return await read();
    } catch (error) {
        console.warn('[Evaluation] Could not read chatbot profile input', { file, code: error?.code || error?.name });
        return null;
    }
}

export async function createProjectProfileSource(db, projectId, { description, snapshotId } = {}) {
    if (description !== undefined && typeof description !== 'string') {
        fail('INVALID_DESCRIPTION', 'Enter a chatbot description');
    }
    const trimmedDescription = (description || '').trim();
    if (trimmedDescription.length > DESCRIPTION_LIMIT) {
        fail('INVALID_DESCRIPTION', 'Use at most 5,000 characters');
    }

    const snapshot = await resolveProjectSnapshot(db, projectId, snapshotId);
    const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
    const files = new Set();
    const prompts = [];
    const packageDescriptions = new Set();
    let readme = '';

    if (snapshot) {
        const workspace = snapshotWorkspaceRoot(snapshot) || normalizeDiskPath(snapshot.rootDir);
        const analysis = await readOptional('.', () => analyzeChatbotWorkspace(workspace));
        const readFile = async (file, maxBytes = Infinity) => {
            const filename = resolveSnapshotFile(snapshot, file);
            const stat = await fs.stat(filename);
            return stat.isFile() && stat.size <= maxBytes ? fs.readFile(filename, 'utf8') : null;
        };
        for (const prompt of analysis?.systemPromptTexts || []) {
            if (!prompt.text.trim()) continue;
            prompts.push(prompt);
            files.add(prompt.file);
        }
        const promptDocs = (analysis?.summary?.candidateDocs || []).filter(doc =>
            ['md', 'txt'].includes(doc.format)
            && doc.sizeBytes <= PROMPT_FILE_LIMIT
            && /(system[-_ ]?prompt|persona|instructions?)/i.test(doc.name),
        ).slice(0, 3);
        for (const { path: file } of promptDocs) {
            const text = await readOptional(file, () => readFile(file, PROMPT_FILE_LIMIT));
            if (!text?.trim()) continue;
            prompts.push({ file, text });
            files.add(file);
        }

        const directories = new Set([analysis?.summary?.launchability?.packageDir || '.', '.']);
        for (const dir of directories) {
            const names = await readOptional(dir, () => fs.readdir(path.join(workspace, dir)));
            if (!names) continue;
            const readmeName = names.find(name => /^readme\.md$/i.test(name));
            if (!readme && readmeName) {
                const file = path.posix.join(dir, readmeName);
                readme = readmeExcerpt(await readOptional(file, () => readFile(file)) || '');
                if (readme) files.add(file);
            }
            const packageName = names.find(name => /^package\.json$/i.test(name));
            if (packageName) {
                const file = path.posix.join(dir, packageName);
                const info = await readOptional(file, async () => JSON.parse(await readFile(file)));
                if (typeof info?.description === 'string' && info.description.trim()) {
                    packageDescriptions.add(info.description.trim());
                    files.add(file);
                }
            }
        }
    }

    if (!trimmedDescription && !prompts.length && !readme && !packageDescriptions.size) {
        fail('PROFILE_EMPTY', 'No system prompt or README was found in this project. Describe your chatbot in a few sentences, then try again.', 422);
    }
    const content = buildChatbotProfile({
        projectName: project?.name,
        description: trimmedDescription,
        packageDescription: [...packageDescriptions].join('\n\n'),
        prompts,
        readme,
    });
    const provenance = { type: CHATBOT_PROFILE, snapshotId: snapshot?.id || null, files: [...files] };
    const saved = await saveKnowledge(db, projectId, {
        name: 'Chatbot profile',
        sourceKey: 'chatbot-profile',
        format: 'md',
        content,
        contentHash: hash(content),
        provenance,
    });
    return { ...saved, files: provenance.files };
}
