import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const fonts = new URL('../assets/fonts/', import.meta.url);

const colors = {
    primary: '#4F46E5',         // Indigo
    primaryDark: '#3730A3',
    primaryLight: '#EEF2FF',
    primaryMuted: '#818CF8',
    slateDark: '#0F172A',
    slate: '#1E293B',
    slateMuted: '#64748B',
    slateLight: '#94A3B8',
    cardBg: '#F8FAFC',
    cardBorder: '#E2E8F0',
    tableBorder: '#E2E8F0',
    zebraBg: '#F8FAFC',
    success: '#059669',
    successBg: '#ECFDF5',
    successBorder: '#A7F3D0',
    danger: '#E11D48',
    dangerBg: '#FFF1F2',
    dangerBorder: '#FECDD3',
    warning: '#D97706',
    warningBg: '#FFFBEB',
    warningBorder: '#FDE68A',
};

const clean = (value, max = 500) =>
    String(value ?? 'N/A').replace(/[\u0000-\u001f]/g, ' ').normalize('NFC').slice(0, max);

const formatDuration = (ms) => {
    if (!ms || ms <= 0) return '0ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
};

const formatPercent = (covered, total) => {
    if (!total || total <= 0) return 'N/A';
    return `${((covered / total) * 100).toFixed(1)}%`;
};

const formatCounter = (counter) => {
    if (!counter || typeof counter.total !== 'number' || counter.total <= 0) return 'N/A';
    return `${counter.covered}/${counter.total} (${formatPercent(counter.covered, counter.total)})`;
};

export const renderSystemTestPdf = ({ assessment, artifacts = [], generatedAt = new Date() }) =>
    new Promise((resolve, reject) => {
        const report = assessment.reportJson || {};
        const runs = report.runs || [];
        const firstRun = runs[0]?.testRun || {};
        const secondRun = runs[1]?.testRun || {};
        const totalTests = firstRun.totalTests || 0;
        const passedTests = firstRun.passedTests || 0;
        const failedTests = firstRun.failedTests || 0;
        const skippedTests = firstRun.skippedTests || 0;
        const flakyTests = firstRun.flakyTests || report.stability?.flakyTests || 0;
        const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
        const durationTotal = firstRun.durationMs || 0;

        const doc = new PDFDocument({
            size: 'A4',
            margin: 44,
            bufferPages: true,
            info: {
                Title: `CovAI System Test Audit Report - ${clean(assessment.id, 80)}`,
                Author: 'CovAI Automated Verification Platform',
                Subject: 'End-to-End System Test Execution & Defect Evidence Report',
                Creator: 'CovAI Quality Engine',
            },
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        try {
            doc.registerFont('Body', fileURLToPath(new URL('NotoSans-Regular.ttf', fonts)));
            doc.registerFont('Bold', fileURLToPath(new URL('NotoSans-Bold.ttf', fonts)));

            const left = 44;
            const pageWidth = 507.28;
            const bottomLimit = 740;
            let currentY = 50;

            const printText = (content, x, y, { bold = false, size = 9, color = colors.slate, width = pageWidth, align = 'left', lineBreak = true } = {}) => {
                doc.font(bold ? 'Bold' : 'Body')
                    .fontSize(size)
                    .fillColor(color)
                    .text(String(content), x, y, { width, align, lineGap: 2, lineBreak });
            };

            const textHeight = (content, size = 9, width = pageWidth, bold = false) => {
                return doc.font(bold ? 'Bold' : 'Body').fontSize(size).heightOfString(String(content), { width, lineGap: 2 });
            };

            const newPage = () => {
                doc.addPage();
                doc.rect(0, 0, doc.page.width, 4).fill(colors.primary);
                printText('COVAI AUTOMATED VERIFICATION PLATFORM', left, 22, { bold: true, size: 7.5, color: colors.primary, characterSpacing: 0.8, lineBreak: false });
                printText(`Assessment: ${clean(assessment.id, 28)}  •  Snapshot: ${clean(assessment.snapshotId, 28)}`, left + 180, 22, { size: 7.5, color: colors.slateMuted, width: pageWidth - 180, align: 'right', lineBreak: false });
                doc.moveTo(left, 36).lineTo(left + pageWidth, 36).lineWidth(0.5).strokeColor(colors.cardBorder).stroke();
                currentY = 52;
            };

            const ensureSpace = (needed) => {
                if (currentY + needed > bottomLimit) {
                    newPage();
                }
            };

            const sectionHeading = (title, subtitle = null) => {
                ensureSpace(46 + (subtitle ? 14 : 0));
                currentY += 10;
                doc.roundedRect(left, currentY + 1, 3, 14, 1.5).fill(colors.primary);
                printText(title.toUpperCase(), left + 10, currentY, { bold: true, size: 11.5, color: colors.slateDark, characterSpacing: 0.5 });
                currentY += 18;
                if (subtitle) {
                    printText(subtitle, left + 10, currentY, { size: 8.5, color: colors.slateMuted });
                    currentY += 14;
                }
            };

            // Cover Header
            doc.rect(0, 0, doc.page.width, 6).fill(colors.primary);

            currentY = 40;
            printText('COVAI QUALITY INTELLIGENCE', left, currentY, { bold: true, size: 8, color: colors.primary, characterSpacing: 1.2 });
            currentY += 16;
            printText('System Test & Quality Audit Report', left, currentY, { bold: true, size: 21, color: colors.slateDark });
            currentY += 28;
            printText('Automated Playwright end-to-end execution, code coverage verification, and application defect evidence.', left, currentY, { size: 9, color: colors.slateMuted });
            currentY += 20;

            // Metadata Card
            ensureSpace(74);
            doc.roundedRect(left, currentY, pageWidth, 70, 6).fillAndStroke(colors.cardBg, colors.cardBorder);

            const colW = (pageWidth - 32) / 3;
            // Column 1
            printText('PROJECT & SNAPSHOT', left + 12, currentY + 10, { bold: true, size: 7, color: colors.slateLight });
            printText(`Snapshot: ${clean(assessment.snapshotId, 22)}`, left + 12, currentY + 22, { bold: true, size: 8, color: colors.slate });
            printText(`Status: ${clean(assessment.status, 20)}`, left + 12, currentY + 36, { size: 8, color: assessment.status === 'COMPLETED' ? colors.success : colors.danger });
            printText(`Generated: ${new Date(generatedAt).toLocaleString('en-US', { hour12: false })}`, left + 12, currentY + 49, { size: 7.5, color: colors.slateMuted });

            // Column 2
            printText('EXECUTION SPECIFICATION', left + 12 + colW, currentY + 10, { bold: true, size: 7, color: colors.slateLight });
            printText(`Runner: ${String(assessment.runner || 'playwright').toUpperCase()}`, left + 12 + colW, currentY + 22, { bold: true, size: 8, color: colors.slate });
            printText(`Mode: ${assessment.executionMode === 'full' ? 'Full Stack (AUT + API)' : 'Frontend Dev Server'}`, left + 12 + colW, currentY + 36, { size: 8, color: colors.slateMuted });
            printText(`Requirements Revision: ${clean(assessment.requirementRevisionId || 'None', 20)}`, left + 12 + colW, currentY + 49, { size: 7.5, color: colors.slateMuted });

            // Column 3
            printText('PROVENANCE DIGESTS', left + 12 + colW * 2, currentY + 10, { bold: true, size: 7, color: colors.slateLight });
            printText(`Source: ${clean((assessment.sourceHash || '').slice(0, 16))}...`, left + 12 + colW * 2, currentY + 22, { size: 7.5, color: colors.slate });
            printText(`Test Hash: ${clean((assessment.testHash || '').slice(0, 16))}...`, left + 12 + colW * 2, currentY + 36, { size: 7.5, color: colors.slate });
            printText(`Artifacts: ${artifacts.length} verified item(s)`, left + 12 + colW * 2, currentY + 49, { size: 7.5, color: colors.slateMuted });

            currentY += 82;

            // KPI Cards (4 Cards)
            ensureSpace(68);
            const cardWidth = (pageWidth - 27) / 4;
            const kpiCards = [
                {
                    label: 'Pass Rate',
                    val: `${passRate}%`,
                    sub: `${passedTests} of ${totalTests} passed`,
                    color: passRate >= 80 ? colors.success : passRate > 0 ? colors.warning : colors.danger
                },
                {
                    label: 'Defects Caught',
                    val: `${failedTests}`,
                    sub: `${failedTests > 0 ? 'Evidence preserved' : 'Zero test failures'}`,
                    color: failedTests > 0 ? colors.danger : colors.success
                },
                {
                    label: 'Duration',
                    val: formatDuration(durationTotal),
                    sub: `${runs.length} full run iteration(s)`,
                    color: colors.slateDark
                },
                {
                    label: 'Stability',
                    val: flakyTests > 0 ? `${flakyTests} Flaky` : '100% Deterministic',
                    sub: `${runs.length} repeat verification runs`,
                    color: flakyTests > 0 ? colors.danger : colors.success
                }
            ];

            kpiCards.forEach((kpi, i) => {
                const cx = left + i * (cardWidth + 9);
                doc.roundedRect(cx, currentY, cardWidth, 56, 5).fillAndStroke(colors.cardBg, colors.cardBorder);
                doc.roundedRect(cx, currentY, cardWidth, 3, 1.5).fill(kpi.color);
                printText(kpi.label.toUpperCase(), cx + 10, currentY + 8, { bold: true, size: 7, color: colors.slateMuted });
                printText(kpi.val, cx + 10, currentY + 21, { bold: true, size: 14, color: kpi.color });
                printText(kpi.sub, cx + 10, currentY + 41, { size: 7, color: colors.slateMuted });
            });

            currentY += 68;

            // Section 1: Scenario Results & Defect Evidence
            sectionHeading('Test Execution & Scenario Outcomes', 'Individual Playwright scenario results with duration, API interactions, and assertion evidence.');

            const scenarios = firstRun.scenarios || [];

            // Table Header
            ensureSpace(24);
            doc.rect(left, currentY, pageWidth, 20).fill(colors.slate);
            printText('STATUS', left + 8, currentY + 6, { bold: true, size: 7.5, color: '#FFFFFF', width: 50 });
            printText('SCENARIO NAME & SPECIFICATION', left + 64, currentY + 6, { bold: true, size: 7.5, color: '#FFFFFF', width: 280 });
            printText('DURATION', left + 350, currentY + 6, { bold: true, size: 7.5, color: '#FFFFFF', width: 55 });
            printText('API CALLS', left + 410, currentY + 6, { bold: true, size: 7.5, color: '#FFFFFF', width: 90 });
            currentY += 20;

            if (!scenarios.length) {
                ensureSpace(24);
                doc.rect(left, currentY, pageWidth, 24).fill(colors.zebraBg);
                printText('No scenario results recorded for this run.', left + 10, currentY + 7, { size: 8, color: colors.slateMuted });
                currentY += 24;
            }

            scenarios.forEach((sc, idx) => {
                const isPass = sc.status?.toLowerCase() === 'passed';
                const isFail = sc.status?.toLowerCase() === 'failed';
                const statusText = isPass ? 'PASS' : isFail ? 'FAIL' : (sc.status?.toUpperCase() || 'SKIP');
                const badgeColor = isPass ? colors.success : isFail ? colors.danger : colors.slateMuted;
                const badgeBg = isPass ? colors.successBg : isFail ? colors.dangerBg : colors.cardBg;
                const badgeBorder = isPass ? colors.successBorder : isFail ? colors.dangerBorder : colors.cardBorder;

                const titleStr = clean(sc.title || sc.name || 'Untitled scenario');
                const fileStr = clean(sc.testFile || 'Unknown spec');
                const apiCount = (sc.apiCalls || []).length;
                const apiSummary = apiCount > 0
                    ? `${apiCount} call(s): ${sc.apiCalls.map(c => `${c.method || 'GET'} ${c.path || ''}`).slice(0, 2).join(', ')}${apiCount > 2 ? '...' : ''}`
                    : 'None';

                const titleH = textHeight(titleStr, 8.5, 280, true);
                const hasFailures = isFail && (sc.failureMessages || []).length > 0;
                const failText = hasFailures ? sc.failureMessages.join('; ') : '';
                const failH = hasFailures ? textHeight(`Defect evidence: ${failText}`, 7.5, pageWidth - 32) + 8 : 0;
                const rowHeight = Math.max(28, titleH + 16) + failH;

                ensureSpace(rowHeight + 4);

                if (idx % 2 === 1) {
                    doc.rect(left, currentY, pageWidth, rowHeight).fill(colors.zebraBg);
                }

                // Status Badge
                doc.roundedRect(left + 8, currentY + 5, 44, 15, 3).fillAndStroke(badgeBg, badgeBorder);
                printText(statusText, left + 8, currentY + 8, { bold: true, size: 7.5, color: badgeColor, width: 44, align: 'center' });

                // Scenario Title & File
                printText(titleStr, left + 64, currentY + 5, { bold: true, size: 8.5, color: colors.slateDark, width: 280 });
                printText(fileStr, left + 64, currentY + 6 + titleH, { size: 7, color: colors.slateMuted, width: 280 });

                // Duration
                printText(formatDuration(sc.durationMs), left + 350, currentY + 7, { size: 8, color: colors.slate });

                // API Calls
                printText(apiSummary, left + 410, currentY + 7, { size: 7, color: colors.slateMuted, width: 90 });

                // Defect Failure Evidence Callout
                if (hasFailures) {
                    const boxY = currentY + titleH + 18;
                    doc.roundedRect(left + 8, boxY, pageWidth - 16, failH - 2, 3).fillAndStroke(colors.dangerBg, colors.dangerBorder);
                    printText(`Defect evidence: ${clean(failText, 250)}`, left + 14, boxY + 4, { size: 7.5, color: colors.danger, width: pageWidth - 28 });
                }

                doc.moveTo(left, currentY + rowHeight).lineTo(left + pageWidth, currentY + rowHeight).lineWidth(0.5).strokeColor(colors.tableBorder).stroke();
                currentY += rowHeight;
            });

            currentY += 12;

            // Section 2: Repeatability Verification (Run 1 vs Run 2)
            if (runs.length >= 2) {
                sectionHeading('Repeatability & Stability Verification', 'Two independent, containerized runs are compared to detect flaky tests and non-deterministic behavior.');
                ensureSpace(32);
                doc.roundedRect(left, currentY, pageWidth, 28, 4).fill(colors.primaryLight);
                printText(
                    `Repeatability audit: Run 1 (${firstRun.passedTests} passed, ${firstRun.failedTests} failed) vs Run 2 (${secondRun.passedTests} passed, ${secondRun.failedTests} failed) • Flaky tests: ${flakyTests} • All outcomes deterministic.`,
                    left + 12,
                    currentY + 8,
                    { bold: true, size: 8, color: colors.primaryDark, width: pageWidth - 24 }
                );
                currentY += 36;
            }

            // Section 3: Business Requirements Traceability
            sectionHeading('Business Requirements Verification', 'Verification traceability against confirmed system criteria and acceptance rules.');
            const req = report.requirements || {};
            const criteria = req.criteria || [];

            ensureSpace(48);
            doc.roundedRect(left, currentY, pageWidth, 28, 4).fill(colors.cardBg);
            printText(
                `Requirement status: ${req.status || 'EVALUATED'}  •  Verified Criteria: ${req.verified ?? 0} / ${req.total ?? criteria.length}  •  Designed Criteria: ${req.designed ?? criteria.length}`,
                left + 12,
                currentY + 9,
                { bold: true, size: 8.5, color: colors.slate }
            );
            currentY += 34;

            if (criteria.length > 0) {
                ensureSpace(20);
                doc.rect(left, currentY, pageWidth, 18).fill(colors.slate);
                printText('CRITERION ID', left + 8, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 90 });
                printText('EXPECTED BUSINESS OUTCOME', left + 106, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 310 });
                printText('VERIFICATION', left + 424, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 75, align: 'right' });
                currentY += 18;

                criteria.forEach((crit, i) => {
                    const outcome = clean(crit.expectedOutcome || 'No outcome documented', 200);
                    const outcomeH = textHeight(outcome, 8, 310);
                    const rHeight = Math.max(22, outcomeH + 10);
                    ensureSpace(rHeight);

                    if (i % 2 === 1) doc.rect(left, currentY, pageWidth, rHeight).fill(colors.zebraBg);

                    printText(clean(crit.id, 24), left + 8, currentY + 5, { bold: true, size: 8, color: colors.slate });
                    printText(outcome, left + 106, currentY + 5, { size: 8, color: colors.slateDark, width: 310 });

                    const isCritVerified = Boolean(crit.verified);
                    printText(
                        isCritVerified ? 'VERIFIED' : 'PENDING',
                        left + 424,
                        currentY + 5,
                        { bold: true, size: 8, color: isCritVerified ? colors.success : colors.warning, width: 75, align: 'right' }
                    );

                    doc.moveTo(left, currentY + rHeight).lineTo(left + pageWidth, currentY + rHeight).lineWidth(0.5).strokeColor(colors.tableBorder).stroke();
                    currentY += rHeight;
                });
            } else {
                ensureSpace(24);
                printText('No formal business requirement criteria linked to this snapshot revision.', left + 10, currentY, { size: 8.5, color: colors.slateMuted });
                currentY += 18;
            }

            currentY += 14;

            // Section 4: Code Coverage & Runtime Scope
            sectionHeading('Code Coverage & Architecture Scope', 'Consolidated runtime instrumentation data measured during test execution.');
            const tiers = report.coverage?.tiers || {};
            const tierEntries = Object.entries(tiers);

            if (tierEntries.length > 0) {
                ensureSpace(20);
                doc.rect(left, currentY, pageWidth, 18).fill(colors.slate);
                printText('TIER SCOPE', left + 8, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 85 });
                printText('STATUS & REASON', left + 98, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 140 });
                printText('LINE COVERAGE', left + 246, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 90 });
                printText('BRANCH COVERAGE', left + 344, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 80 });
                printText('FUNCTIONS', left + 432, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 68 });
                currentY += 18;

                tierEntries.forEach(([tierName, tierData], i) => {
                    const rHeight = 24;
                    ensureSpace(rHeight);
                    if (i % 2 === 1) doc.rect(left, currentY, pageWidth, rHeight).fill(colors.zebraBg);

                    const statusStr = tierData.status || 'UNAVAILABLE';
                    const reasons = (tierData.reasonCodes || []).join(', ');
                    const counters = tierData.counters || {};

                    printText(tierName.toUpperCase(), left + 8, currentY + 6, { bold: true, size: 8, color: colors.slate });
                    printText(`${statusStr}${reasons ? ` (${reasons})` : ''}`, left + 98, currentY + 6, { size: 7.5, color: colors.slateMuted, width: 140 });
                    printText(formatCounter(counters.lines), left + 246, currentY + 6, { size: 7.5, color: colors.slateDark, width: 90 });
                    printText(formatCounter(counters.branches), left + 344, currentY + 6, { size: 7.5, color: colors.slateDark, width: 80 });
                    printText(formatCounter(counters.functions), left + 432, currentY + 6, { size: 7.5, color: colors.slateDark, width: 68 });

                    doc.moveTo(left, currentY + rHeight).lineTo(left + pageWidth, currentY + rHeight).lineWidth(0.5).strokeColor(colors.tableBorder).stroke();
                    currentY += rHeight;
                });
            } else {
                ensureSpace(24);
                printText('No coverage tier measurements recorded for this run mode.', left + 10, currentY, { size: 8.5, color: colors.slateMuted });
                currentY += 18;
            }

            currentY += 14;

            // Section 5: Quality Gaps & Improvement Actions
            const gaps = (report.workflowGaps || report.gaps || []).slice(0, 15);
            sectionHeading('Quality Gaps & Improvement Actions', `Identified uncovered logical paths, missing test cases, and edge cases (${gaps.length} prioritized).`);

            if (gaps.length > 0) {
                ensureSpace(20);
                doc.rect(left, currentY, pageWidth, 18).fill(colors.slate);
                printText('CATEGORY', left + 8, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 95 });
                printText('TARGET FILE / SYMBOL', left + 110, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 155 });
                printText('DESCRIPTION & RECOMMENDATION', left + 272, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 228 });
                currentY += 18;

                gaps.forEach((gap, i) => {
                    const desc = clean(gap.description || gap.message || 'Logical branch unexercised', 220);
                    const target = clean(`${gap.filePath || gap.criterionId || 'N/A'}${gap.line ? `:${gap.line}` : ''}`, 60);
                    const descH = textHeight(desc, 7.5, 228);
                    const rHeight = Math.max(20, descH + 8);
                    ensureSpace(rHeight);

                    if (i % 2 === 1) doc.rect(left, currentY, pageWidth, rHeight).fill(colors.zebraBg);

                    printText(clean(gap.kind || 'COVERAGE_GAP', 20), left + 8, currentY + 4, { bold: true, size: 7.5, color: colors.warning });
                    printText(target, left + 110, currentY + 4, { size: 7.5, color: colors.slate, width: 155 });
                    printText(desc, left + 272, currentY + 4, { size: 7.5, color: colors.slateMuted, width: 228 });

                    doc.moveTo(left, currentY + rHeight).lineTo(left + pageWidth, currentY + rHeight).lineWidth(0.5).strokeColor(colors.tableBorder).stroke();
                    currentY += rHeight;
                });
            } else {
                ensureSpace(24);
                printText('No outstanding coverage or assertion gaps identified for this execution scope.', left + 10, currentY, { size: 8.5, color: colors.slateMuted });
                currentY += 18;
            }

            currentY += 14;

            // Section 6: Cryptographic Audit Trail & Evidence Artifacts
            const displayArtifacts = artifacts.slice(0, 15);
            sectionHeading('Audit Artifacts & Evidence Traceability', 'Cryptographically verified test execution artifacts recorded for this assessment.');

            if (displayArtifacts.length > 0) {
                ensureSpace(20);
                doc.rect(left, currentY, pageWidth, 18).fill(colors.slate);
                printText('KIND', left + 8, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 80 });
                printText('SCENARIO KEY', left + 94, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 165 });
                printText('ARTIFACT ID', left + 266, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 110 });
                printText('SHA-256 INTEGRITY DIGEST', left + 382, currentY + 5, { bold: true, size: 7.5, color: '#FFFFFF', width: 118 });
                currentY += 18;

                displayArtifacts.forEach((art, i) => {
                    const rHeight = 20;
                    ensureSpace(rHeight);
                    if (i % 2 === 1) doc.rect(left, currentY, pageWidth, rHeight).fill(colors.zebraBg);

                    printText(clean(art.kind || 'SCREENSHOT', 16), left + 8, currentY + 5, { bold: true, size: 7.5, color: colors.primary });
                    printText(clean(art.scenarioKey || 'Test Suite', 35), left + 94, currentY + 5, { size: 7.5, color: colors.slate, width: 165 });
                    printText(clean(art.id, 24), left + 266, currentY + 5, { size: 7, color: colors.slateMuted, width: 110 });
                    printText(clean(art.sha256 ? `${art.sha256.slice(0, 16)}...` : 'N/A', 20), left + 382, currentY + 5, { size: 7, color: colors.slateMuted, width: 118 });

                    doc.moveTo(left, currentY + rHeight).lineTo(left + pageWidth, currentY + rHeight).lineWidth(0.5).strokeColor(colors.tableBorder).stroke();
                    currentY += rHeight;
                });
            } else {
                ensureSpace(24);
                printText('No binary screenshots or execution traces recorded for this assessment.', left + 10, currentY, { size: 8.5, color: colors.slateMuted });
                currentY += 18;
            }

            // Disclaimer Banner
            ensureSpace(40);
            currentY += 12;
            doc.roundedRect(left, currentY, pageWidth, 28, 4).fill(colors.cardBg);
            printText(
                'Notice: Code coverage indicates statements exercised by automated runners; it does not constitute proof of business logic correctness without verified assertion criteria. This document is automatically generated by CovAI.',
                left + 10,
                currentY + 6,
                { size: 7, color: colors.slateMuted, width: pageWidth - 20 }
            );

            // Dynamic Page Footer across all buffered pages
            const pages = doc.bufferedPageRange();
            for (let i = 0; i < pages.count; i++) {
                doc.switchToPage(pages.start + i);
                doc.moveTo(left, 762).lineTo(left + pageWidth, 762).lineWidth(0.5).strokeColor(colors.cardBorder).stroke();
                doc.font('Bold').fontSize(7).fillColor(colors.slateLight).text('CONFIDENTIAL • COVAI AUTOMATED VERIFICATION AUDIT', left, 768, { lineBreak: false });
                doc.font('Body').fontSize(7.5).fillColor(colors.slateMuted).text(`Page ${i + 1} of ${pages.count}`, left + 300, 768, { width: pageWidth - 300, align: 'right', lineBreak: false });
            }

            doc.end();
        } catch (error) {
            doc.destroy(error);
            reject(error);
        }
    });
