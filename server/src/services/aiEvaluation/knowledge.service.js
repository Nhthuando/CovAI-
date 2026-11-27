import fs from 'node:fs/promises';
import { extractSeededKnowledge } from './seededKnowledge.js';
import path from 'node:path';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import YAML from 'yaml';
import { resolveSnapshotFile } from '../../utils/snapshotWorkspace.js';
import { fail, hash, serial } from './common.js';

export const MAX_DOCX_ENTRIES = 2000;
export const MAX_DOCX_XML_BYTES = 20 * 1024 * 1024;
const SUPPORTED_TEXT_FORMATS = ['txt', 'md', 'json', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx'];

function decodeXmlEntities(text) {
    return text
        .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex) => {
            const cp = parseInt(hex, 16);
            return cp >= 0x9 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
        })
        .replace(/&#(\d{1,7});/g, (_, dec) => {
            const cp = parseInt(dec, 10);
            return cp >= 0x9 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
        })
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function extractWordXmlText(xml) {
    const withBreaks = xml
        .replace(/<w:(?:br|cr)\b[^>]*\/?>/gi, '\n')
        .replace(/<w:tab\b[^>]*\/?>/gi, '\t')
        .replace(/<\/w:tc>/gi, '\t')
        .replace(/<\/w:(?:p|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    return decodeXmlEntities(withBreaks)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function inflateDocxEntryBounded(entry, maxBytes) {
    if (entry.header?.encrypted) {
        fail('INVALID_DOCX', 'Encrypted or password-protected DOCX files are not supported');
    }
    let compressed;
    try {
        compressed = entry.getCompressedData();
    } catch {
        fail('INVALID_DOCX', 'Uploaded DOCX archive contains unreadable entry data');
    }
    if (!Buffer.isBuffer(compressed)) {
        fail('INVALID_DOCX', 'Uploaded DOCX archive contains an invalid entry stream');
    }

    const method = entry.header?.method;
    let rawBytes;
    if (method === 0) {
        if (compressed.byteLength > maxBytes) {
            fail('SOURCE_TOO_LARGE', 'DOCX uncompressed XML exceeds the 20 MB safety limit');
        }
        rawBytes = compressed;
    } else if (method === 8) {
        if (compressed.byteLength === 0) {
            rawBytes = Buffer.alloc(0);
        } else {
            try {
                rawBytes = zlib.inflateRawSync(compressed, { maxOutputLength: maxBytes + 1 });
            } catch (err) {
                if (err?.code === 'ERR_BUFFER_TOO_LARGE' || /Cannot create a Buffer larger than|maxOutputLength/i.test(err?.message || '')) {
                    fail('SOURCE_TOO_LARGE', 'DOCX uncompressed XML exceeds the 20 MB safety limit');
                }
                fail('INVALID_DOCX', 'Uploaded DOCX archive contains corrupted compressed data');
            }
            if (rawBytes.byteLength > maxBytes) {
                fail('SOURCE_TOO_LARGE', 'DOCX uncompressed XML exceeds the 20 MB safety limit');
            }
        }
    } else {
        fail('INVALID_DOCX', 'Uploaded DOCX archive uses an unsupported compression method');
    }

    if (typeof zlib.crc32 === 'function' && !entry.header?.flags_desc && rawBytes.byteLength > 0) {
        if ((zlib.crc32(rawBytes) >>> 0) !== (entry.header.crc >>> 0)) {
            fail('INVALID_DOCX', 'Uploaded DOCX archive failed CRC integrity verification');
        }
    }

    let xml;
    try {
        xml = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    } catch {
        fail('INVALID_DOCX', 'Uploaded DOCX archive contains invalid UTF-8 XML content');
    }
    return { xml, byteLength: rawBytes.byteLength };
}

function extractDocxBuffer(buffer) {
    let zip;
    let entries;
    try {
        zip = new AdmZip(buffer);
        entries = zip.getEntries();
    } catch {
        fail('INVALID_DOCX', 'Uploaded DOCX archive is corrupted or not a valid Word document');
    }
    if (!Array.isArray(entries) || entries.length > MAX_DOCX_ENTRIES) {
        fail('INVALID_DOCX', `Uploaded DOCX archive exceeds the maximum limit of ${MAX_DOCX_ENTRIES.toLocaleString('en-US')} entries`);
    }
    const docEntry = entries.find(entry => entry.entryName === 'word/document.xml' && !entry.isDirectory);
    if (!docEntry) {
        fail('INVALID_DOCX', 'Uploaded DOCX archive does not contain word/document.xml');
    }

    const targetEntries = entries
        .filter(entry => !entry.isDirectory && /^word\/(?:header\d+|document|footer\d+)\.xml$/i.test(entry.entryName))
        .sort((a, b) => {
            const rank = name => (name.includes('header') ? 0 : name.includes('document') ? 1 : 2);
            return rank(a.entryName) - rank(b.entryName) || a.entryName.localeCompare(b.entryName);
        });

    let remainingBytes = MAX_DOCX_XML_BYTES;
    const sections = [];
    for (const entry of targetEntries) {
        // Never trust entry.header.size (central/local ZIP headers can be spoofed in zip-bombs).
        const { xml, byteLength } = inflateDocxEntryBounded(entry, remainingBytes);
        remainingBytes -= byteLength;
        const sectionText = extractWordXmlText(xml);
        if (sectionText) sections.push(sectionText);
    }

    const merged = sections.join('\n\n').trim();
    if (!merged) {
        fail('EMPTY_DOCX', 'This DOCX file contains no extractable text.');
    }
    return merged;
}

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
            if (pages.every(text => text.replace(/\[Page \d+\]/, '').trim().length === 0)) {
                fail('OCR_UNSUPPORTED', 'This PDF has no extractable text. Supply a text PDF or paste the content.');
            }
            content = pages.join('\n\n');
        } finally {
            await document.destroy();
        }
    } else if (format === 'docx') {
        content = extractDocxBuffer(buffer);
    } else {
        if (!SUPPORTED_TEXT_FORMATS.includes(format)) {
            fail('UNSUPPORTED_SOURCE', 'Use TXT, Markdown, DOCX, JSON, YAML, text PDF or a source file');
        }
        try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
            fail('INVALID_ENCODING', 'Text source must be valid UTF-8');
        }
        if (format === 'json') {
            try { JSON.parse(content); } catch { fail('INVALID_JSON_SOURCE', 'JSON source file is malformed'); }
        }
        if (['yaml', 'yml'].includes(format)) {
            try { YAML.parse(content, { maxAliasCount: 20 }); } catch { fail('INVALID_YAML_SOURCE', 'YAML source file is malformed'); }
        }
    }
    if (!content.trim() || content.length > 200000) fail('INVALID_SOURCE_SIZE', 'Source must contain 1 to 200,000 text characters');
    return { format, content, contentHash: hash(content) };
}

export async function snapshotKnowledge(db, projectId, snapshotId, filePath, { extract = null } = {}) {
    const snapshot = await db.projectSnapshot.findFirst({
        where: { id: snapshotId, projectId },
        select: { id: true, projectId: true, source: true, rootDir: true, storagePath: true },
    });
    if (!snapshot) fail('NOT_FOUND', 'Snapshot not found', 404);
    if (/(^|[\\/])(\.env(?:\..*)?|[^/\\]*\.(?:pem|key|p12))$/i.test(filePath)) {
        fail('SECRET_SOURCE', 'Credential files cannot be imported as evaluation knowledge');
    }
    const filename = resolveSnapshotFile(snapshot, filePath);
    if ((await fs.stat(filename)).size > 10 * 1024 * 1024) fail('SOURCE_TOO_LARGE', 'Source limit is 10 MB');
    if (extract === 'SEEDED_KNOWLEDGE') {
        // The knowledge a seed script writes into the chatbot database, not the script itself.
        const text = extractSeededKnowledge(await fs.readFile(filename, 'utf8'), filePath);
        if (!text) fail('NO_SEEDED_KNOWLEDGE', 'This file does not seed any chatbot knowledge', 422);
        return { ...await extractKnowledge(Buffer.from(text, 'utf8'), 'seeded-knowledge.md'), provenance: { type: 'SNAPSHOT', snapshotId, filePath, extract } };
    }
    return { ...await extractKnowledge(await fs.readFile(filename), filePath), provenance: { type: 'SNAPSHOT', snapshotId, filePath } };
}

export async function saveKnowledge(db, projectId, input) {
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const sourceKey = input.sourceKey || input.name;
        const latest = await tx.aiEvaluationKnowledgeSource.findFirst({
            where: { projectId, sourceKey },
            orderBy: { version: 'desc' },
            select: { version: true },
        });
        return tx.aiEvaluationKnowledgeSource.create({
            data: {
                projectId,
                name: input.name,
                sourceKey,
                version: (latest?.version || 0) + 1,
                format: input.format,
                status: input.status || 'READY',
                content: input.content,
                contentHash: input.contentHash,
                provenance: input.provenance,
            },
            select: {
                id: true,
                projectId: true,
                name: true,
                sourceKey: true,
                version: true,
                format: true,
                status: true,
                contentHash: true,
                provenance: true,
                createdAt: true,
            },
        });
    });
}
