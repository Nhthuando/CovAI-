import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { resolveSnapshotFile } from '../../utils/snapshotWorkspace.js';
import { fail, hash, serial } from './common.js';

export async function extractKnowledge(buffer, name) {
    if (buffer.length > 10 * 1024 * 1024) fail('SOURCE_TOO_LARGE', 'Source limit is 10 MB');
    const format = path.extname(name).slice(1).toLowerCase();
    let content;
    if (format === 'pdf') {
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const document = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
        try {
            if (document.numPages > 100) fail('PDF_PAGE_LIMIT', 'PDF limit is 100 pages');
            const pages = [];
            for (let page = 1; page <= document.numPages; page++) {
                const text = await (await document.getPage(page)).getTextContent();
                pages.push(`[Page ${page}]\n${text.items.map(item => item.str || '').join(' ')}`);
                if (pages.join('\n').length > 200000) fail('SOURCE_TOO_LARGE', 'Extracted text limit is 200,000 characters');
            }
            if (pages.every(text => text.replace(/\[Page \d+\]/, '').trim().length === 0)) fail('OCR_UNSUPPORTED', 'This PDF has no extractable text. Supply a text PDF or paste the content.');
            content = pages.join('\n\n');
        } finally { await document.destroy(); }
    } else {
        if (!['txt', 'md', 'json', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx'].includes(format)) fail('UNSUPPORTED_SOURCE', 'Use TXT, Markdown, JSON, YAML, text PDF or a source file');
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        if (format === 'json') JSON.parse(content);
        if (['yaml', 'yml'].includes(format)) YAML.parse(content, { maxAliasCount: 20 });
    }
    if (!content.trim() || content.length > 200000) fail('INVALID_SOURCE_SIZE', 'Source must contain 1 to 200,000 text characters');
    return { format, content, contentHash: hash(content) };
}
export async function snapshotKnowledge(db, projectId, snapshotId, filePath) {
    const snapshot = await db.projectSnapshot.findFirst({ where: { id: snapshotId, projectId } });
    if (!snapshot) fail('NOT_FOUND', 'Snapshot not found', 404);
    if (/(^|[\\/])(\.env(?:\..*)?|[^/\\]*\.(?:pem|key))$/i.test(filePath)) fail('SECRET_SOURCE', 'Credential files cannot be imported as evaluation knowledge');
    const filename = resolveSnapshotFile(snapshot, filePath);
    if ((await fs.stat(filename)).size > 10 * 1024 * 1024) fail('SOURCE_TOO_LARGE', 'Source limit is 10 MB');
    return { ...await extractKnowledge(await fs.readFile(filename), filePath), provenance: { type: 'SNAPSHOT', snapshotId, filePath } };
}
export async function saveKnowledge(db, projectId, input) {
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const sourceKey = input.sourceKey || input.name;
        const latest = await tx.aiEvaluationKnowledgeSource.findFirst({ where: { projectId, sourceKey }, orderBy: { version: 'desc' } });
        return tx.aiEvaluationKnowledgeSource.create({ data: { projectId, name: input.name, sourceKey, version: (latest?.version || 0) + 1, format: input.format, status: input.status || 'READY', content: input.content, contentHash: input.contentHash, provenance: input.provenance } });
    });
}
