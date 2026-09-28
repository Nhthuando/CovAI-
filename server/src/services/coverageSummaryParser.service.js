import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * SCRUM-85: Coverage Summary Parser
 *
 * Parse coverage-summary.json được sinh bởi Jest và lưu vào DB:
 *  - SCRUM-118: Parse line coverage
 *  - SCRUM-119: Parse branch coverage
 *  - SCRUM-120: Parse function coverage
 *  - SCRUM-121: Parse statement coverage
 *  - SCRUM-122: Create/update CoverageSummary record
 */

/**
 * Đọc và validate file coverage-summary.json từ coverageDir.
 * Trả về object raw đã parse.
 */
const readCoverageSummaryFile = (coverageDir) => {
    const summaryPath = path.join(coverageDir, "coverage-summary.json");

    if (!fs.existsSync(summaryPath)) {
        throw new ServiceError(
            `Không tìm thấy coverage-summary.json tại: ${summaryPath}`,
            404
        );
    }

    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    } catch (err) {
        throw new ServiceError(`Không thể parse coverage-summary.json: ${err.message}`, 422);
    }

    if (!raw || typeof raw !== "object") {
        throw new ServiceError("coverage-summary.json không hợp lệ (empty or not an object)", 422);
    }

    if (!raw.total) {
        throw new ServiceError("coverage-summary.json thiếu trường 'total'", 422);
    }

    return raw;
};

const parsePct = (val) => {
    if (typeof val === "number" && !isNaN(val)) return val;
    if (typeof val === "string") {
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) return parsed;
    }
    return 0;
};

const parseNum = (val) => {
    if (typeof val === "number" && !isNaN(val)) return val;
    if (typeof val === "string") {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) return parsed;
    }
    return 0;
};

/**
 * SCRUM-118: Parse line coverage từ một entry Jest
 */
const parseLineCoverage = (entry) => ({
    total: parseNum(entry?.lines?.total),
    covered: parseNum(entry?.lines?.covered),
    skipped: parseNum(entry?.lines?.skipped),
    pct: parsePct(entry?.lines?.pct),
});

/**
 * SCRUM-119: Parse branch coverage từ một entry Jest
 */
const parseBranchCoverage = (entry) => ({
    total: parseNum(entry?.branches?.total),
    covered: parseNum(entry?.branches?.covered),
    skipped: parseNum(entry?.branches?.skipped),
    pct: parsePct(entry?.branches?.pct),
});

/**
 * SCRUM-120: Parse function coverage từ một entry Jest
 */
const parseFunctionCoverage = (entry) => ({
    total: parseNum(entry?.functions?.total),
    covered: parseNum(entry?.functions?.covered),
    skipped: parseNum(entry?.functions?.skipped),
    pct: parsePct(entry?.functions?.pct),
});

/**
 * SCRUM-121: Parse statement coverage từ một entry Jest
 */
const parseStatementCoverage = (entry) => ({
    total: parseNum(entry?.statements?.total),
    covered: parseNum(entry?.statements?.covered),
    skipped: parseNum(entry?.statements?.skipped),
    pct: parsePct(entry?.statements?.pct),
});

/**
 * SCRUM-122: Tạo hoặc cập nhật CoverageSummary record trong DB.
 */
const upsertCoverageSummary = async (snapshotId, lines, branches, functions, statements) => {
    const l = parsePct(lines?.pct ?? lines);
    const b = parsePct(branches?.pct ?? branches);
    const f = parsePct(functions?.pct ?? functions);
    const s = parsePct(statements?.pct ?? statements);

    return prisma.coverageSummary.upsert({
        where: { snapshotId },
        create: {
            snapshotId,
            linesPct: l,
            branchesPct: b,
            funcsPct: f,
            stmtsPct: s,
        },
        update: {
            linesPct: l,
            branchesPct: b,
            funcsPct: f,
            stmtsPct: s,
        },
    });
};

/**
 * Upsert CoverageFile records cho từng file trong project.
 */
const upsertCoverageFiles = async (snapshotId, fileEntries) => {
    for (const [filePath, data] of fileEntries) {
        const lines = parseLineCoverage(data);
        const branches = parseBranchCoverage(data);
        const functions = parseFunctionCoverage(data);
        const statements = parseStatementCoverage(data);

        await prisma.coverageFile.upsert({
            where: { snapshotId_filePath: { snapshotId, filePath } },
            create: {
                snapshotId,
                filePath,
                linesPct: parsePct(lines?.pct),
                branchesPct: parsePct(branches?.pct),
                funcsPct: parsePct(functions?.pct),
                stmtsPct: parsePct(statements?.pct),
            },
            update: {
                linesPct: parsePct(lines?.pct),
                branchesPct: parsePct(branches?.pct),
                funcsPct: parsePct(functions?.pct),
                stmtsPct: parsePct(statements?.pct),
            },
        });
    }
};

/**
 * Entry point chính của SCRUM-85.
 *
 * Đọc coverage-summary.json → parse từng loại coverage →
 * lưu CoverageSummary + CoverageFile vào DB.
 *
 * @param {string} coverageDir  - Đường dẫn tới thư mục coverage/ (tạo bởi jest)
 * @param {string} snapshotId   - ID của ProjectSnapshot
 * @returns {{ summary, total, fileCount }}
 */
export const parseCoverageSummary = async (coverageDir, snapshotId) => {
    if (!coverageDir || !snapshotId) {
        throw new ServiceError("coverageDir và snapshotId là bắt buộc", 400);
    }

    // Đọc file
    const raw = readCoverageSummaryFile(coverageDir);

    // Parse tổng hợp (SCRUM-118..121)
    const total = raw.total;
    const lines = parseLineCoverage(total);       // SCRUM-118
    const branches = parseBranchCoverage(total);  // SCRUM-119
    const functions = parseFunctionCoverage(total); // SCRUM-120
    const statements = parseStatementCoverage(total); // SCRUM-121

    // SCRUM-122: Ghi CoverageSummary
    const summary = await upsertCoverageSummary(snapshotId, lines, branches, functions, statements);

    // Ghi CoverageFile từng file (bỏ key "total")
    const fileEntries = Object.entries(raw).filter(([key]) => key !== "total");
    await upsertCoverageFiles(snapshotId, fileEntries);

    return {
        summary,
        total: {
            lines,
            branches,
            functions,
            statements,
        },
        fileCount: fileEntries.length,
    };
};
