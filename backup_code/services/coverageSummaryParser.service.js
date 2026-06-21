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

/**
 * SCRUM-118: Parse line coverage từ một entry Jest
 */
const parseLineCoverage = (entry) => ({
    total: entry.lines?.total ?? 0,
    covered: entry.lines?.covered ?? 0,
    skipped: entry.lines?.skipped ?? 0,
    pct: entry.lines?.pct ?? 0,
});

/**
 * SCRUM-119: Parse branch coverage từ một entry Jest
 */
const parseBranchCoverage = (entry) => ({
    total: entry.branches?.total ?? 0,
    covered: entry.branches?.covered ?? 0,
    skipped: entry.branches?.skipped ?? 0,
    pct: entry.branches?.pct ?? 0,
});

/**
 * SCRUM-120: Parse function coverage từ một entry Jest
 */
const parseFunctionCoverage = (entry) => ({
    total: entry.functions?.total ?? 0,
    covered: entry.functions?.covered ?? 0,
    skipped: entry.functions?.skipped ?? 0,
    pct: entry.functions?.pct ?? 0,
});

/**
 * SCRUM-121: Parse statement coverage từ một entry Jest
 */
const parseStatementCoverage = (entry) => ({
    total: entry.statements?.total ?? 0,
    covered: entry.statements?.covered ?? 0,
    skipped: entry.statements?.skipped ?? 0,
    pct: entry.statements?.pct ?? 0,
});

/**
 * SCRUM-122: Tạo hoặc cập nhật CoverageSummary record trong DB.
 */
const upsertCoverageSummary = async (snapshotId, lines, branches, functions, statements) => {
    return prisma.coverageSummary.upsert({
        where: { snapshotId },
        create: {
            snapshotId,
            linesPct: lines.pct,
            branchesPct: branches.pct,
            funcsPct: functions.pct,
            stmtsPct: statements.pct,
        },
        update: {
            linesPct: lines.pct,
            branchesPct: branches.pct,
            funcsPct: functions.pct,
            stmtsPct: statements.pct,
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
                linesPct: lines.pct,
                branchesPct: branches.pct,
                funcsPct: functions.pct,
                stmtsPct: statements.pct,
            },
            update: {
                linesPct: lines.pct,
                branchesPct: branches.pct,
                funcsPct: functions.pct,
                stmtsPct: statements.pct,
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
