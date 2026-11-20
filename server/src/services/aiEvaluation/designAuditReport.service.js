import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { getChatbotDesignAudit } from './designAudit.service.js';
import { EVALUATION_DISCLAIMER } from './report.service.js';
import { fail } from './common.js';

function renderDesignAuditPdf(report) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 45, size: 'A4', info: { Title: 'Chatbot Design Audit' } });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.font(fileURLToPath(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
        doc.fontSize(18).text('Chatbot Design Audit');
        doc.moveDown().fontSize(10).text(`Project: ${report.projectId}\nSnapshot: ${report.snapshotId}\nGenerated: ${report.generatedAt}`);
        doc.moveDown().text(`Design score: ${report.designScore} / 100`);
        const summary = report.summary || {};
        doc.text(`Severity counts: ${Object.entries(summary.severityCounts || {}).map(([key, count]) => `${key}: ${count}`).join(', ')}`);
        for (const [label, value] of [
            ['SDKs', summary.sdks?.map(sdk => `${sdk.name} (${sdk.provider}, ${sdk.origin})`)],
            ['Env vars', summary.launchability?.requiredLlmEnvVars],
            ['Endpoints', summary.endpoints?.map(endpoint => `${endpoint.method || ''} ${endpoint.endpointPath || ''} (${endpoint.file || ''}:${endpoint.line || ''})`)],
            ['Launchability', summary.launchability ? `${summary.launchability.mode}, ready: ${summary.launchability.ready}; ${summary.launchability.reason || summary.launchability.note || ''}` : undefined],
            ['System prompt locations', summary.systemPrompts?.map(prompt => `${prompt.file}:${prompt.line}`)],
            ['Candidate documents', summary.candidateDocs?.map(document => document.path)],
        ]) {
            doc.moveDown().text(`${label}:`);
            const entries = Array.isArray(value) ? value : [value];
            if (!entries.length) doc.text('None');
            for (const entry of entries) doc.text(String(entry ?? 'None'));
        }
        doc.moveDown().fontSize(13).text('Findings');
        for (const finding of report.findings) {
            doc.moveDown().fontSize(10).text(`${finding.severity} | ${finding.ruleId} | ${finding.title}`);
            doc.text(`${finding.file}:${finding.line}`);
            doc.text(`Recommendation: ${finding.recommendation || ''}`);
            doc.text(String(finding.snippet || '').slice(0, 400));
        }
        doc.moveDown().text(report.disclaimer);
        doc.end();
    });
}

export async function exportDesignAuditReport(db, projectId, userId, format = 'json') {
    const audit = await getChatbotDesignAudit(db, projectId);
    if (audit.status !== 'READY') {
        fail('DESIGN_AUDIT_NOT_READY', 'Run a design audit scan before exporting.', 409);
    }
    const report = {
        generatedAt: new Date().toISOString(),
        projectId,
        snapshotId: audit.snapshotId,
        designScore: audit.designScore,
        detected: audit.detected,
        summary: audit.summary,
        findings: audit.findings,
        disclaimer: EVALUATION_DISCLAIMER,
    };
    const pdf = format === 'pdf';
    return {
        contentType: pdf ? 'application/pdf' : 'application/json',
        filename: `chatbot-design-audit-${projectId}.${pdf ? 'pdf' : 'json'}`,
        body: pdf ? await renderDesignAuditPdf(report) : JSON.stringify(report, null, 2),
    };
}
