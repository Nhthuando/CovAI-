import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { parseLcovFile } from "./lcovParser.service.js";
import { ServiceError } from "../utils/serviceError.js";

const findCoverageFiles = (dir, fileList = []) => {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === "node_modules" || file === ".git") continue;
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            findCoverageFiles(fullPath, fileList);
        } else {
            if (file === "lcov.info" || file === "coverage-summary.json") {
                fileList.push(fullPath);
            }
        }
    }
    return fileList;
};

export const aggregateCoverageReports = async (rootDir, snapshotId) => {
    if (!rootDir || !snapshotId) {
        throw new ServiceError("Thiếu rootDir hoặc snapshotId", 400);
    }

    const files = findCoverageFiles(rootDir);
    if (files.length === 0) {
        throw new Error("Không tìm thấy file coverage nào trong dự án.");
    }

    let globalTotal = {
        lines: { total: 0, covered: 0 },
        functions: { total: 0, covered: 0 },
        branches: { total: 0, covered: 0 },
        statements: { total: 0, covered: 0 }
    };
    
    let allFiles = {};

    for (const file of files) {
        let report;
        if (file.endsWith('lcov.info')) {
            report = parseLcovFile(file);
        } else if (file.endsWith('coverage-summary.json')) {
            report = JSON.parse(fs.readFileSync(file, 'utf-8'));
        }

        if (report && report.total) {
            globalTotal.lines.total += report.total.lines?.total || 0;
            globalTotal.lines.covered += report.total.lines?.covered || 0;
            globalTotal.functions.total += report.total.functions?.total || 0;
            globalTotal.functions.covered += report.total.functions?.covered || 0;
            globalTotal.branches.total += report.total.branches?.total || 0;
            globalTotal.branches.covered += report.total.branches?.covered || 0;
            globalTotal.statements.total += (report.total.statements?.total || report.total.lines?.total || 0);
            globalTotal.statements.covered += (report.total.statements?.covered || report.total.lines?.covered || 0);

            if (report.files) {
                Object.assign(allFiles, report.files); 
            } else {
                const fileEntries = Object.entries(report).filter(([key]) => key !== "total");
                fileEntries.forEach(([key, val]) => {
                    allFiles[key] = val;
                });
            }
        }
    }

    const calcPct = (c, t) => t === 0 ? 100 : parseFloat(((c / t) * 100).toFixed(2));
    
    const linesPct = calcPct(globalTotal.lines.covered, globalTotal.lines.total);
    const funcsPct = calcPct(globalTotal.functions.covered, globalTotal.functions.total);
    const branchesPct = calcPct(globalTotal.branches.covered, globalTotal.branches.total);
    const stmtsPct = calcPct(globalTotal.statements.covered, globalTotal.statements.total);

    const summary = await prisma.coverageSummary.upsert({
        where: { snapshotId },
        create: { snapshotId, linesPct, branchesPct, funcsPct, stmtsPct },
        update: { linesPct, branchesPct, funcsPct, stmtsPct }
    });

    await prisma.coverageFile.deleteMany({ where: { snapshotId } });
    
    const fileInserts = Object.entries(allFiles).map(([filePath, data]) => {
        return {
            snapshotId,
            filePath: filePath.replace(rootDir + path.sep, ''), 
            linesPct: data.lines?.pct ?? calcPct(data.lines?.covered, data.lines?.total),
            branchesPct: data.branches?.pct ?? calcPct(data.branches?.covered, data.branches?.total),
            funcsPct: data.functions?.pct ?? calcPct(data.functions?.covered, data.functions?.total),
            stmtsPct: data.statements?.pct ?? data.lines?.pct ?? calcPct(data.lines?.covered, data.lines?.total)
        };
    });

    if (fileInserts.length > 0) {
        await prisma.coverageFile.createMany({ data: fileInserts });
    }

    return { summary, fileCount: fileInserts.length, filesFound: files.length };
};
