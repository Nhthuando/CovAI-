import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { parseLcovFile } from "./lcovParser.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { canonicalizeFilePath } from "../utils/pathSanitizer.js";
import {
    isBusinessLogicSourceFile,
    extractProjectCoverageExclusions,
} from "../utils/businessLogicFileDetector.js";

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
        throw new ServiceError("Missing rootDir or snapshotId", 400);
    }

    const files = findCoverageFiles(rootDir);
    if (files.length === 0) {
        throw new Error("No coverage files found in project.");
    }

    // Deduplicate by directory (prefer coverage-summary.json over lcov.info)
    // and avoid double-counting root coverage/ when coverage/unit/ is present.
    const byDir = new Map();
    for (const file of files) {
        const dir = path.dirname(file);
        const existing = byDir.get(dir);
        if (!existing || file.endsWith("coverage-summary.json")) {
            byDir.set(dir, file);
        }
    }
    const hasUnitSubdir = Array.from(byDir.keys()).some((d) =>
        /[\\/]coverage[\\/]unit$/i.test(d),
    );
    const selectedReports = Array.from(byDir.entries())
        .filter(([dir]) => !hasUnitSubdir || !/[\\/]coverage$/i.test(dir))
        .map(([, file]) => file);

    const configExclusions = extractProjectCoverageExclusions(rootDir);
    const dedupedFiles = new Map();

    for (const file of selectedReports) {
        let report;
        if (file.endsWith("lcov.info")) {
            report = parseLcovFile(file);
        } else if (file.endsWith("coverage-summary.json")) {
            report = JSON.parse(fs.readFileSync(file, "utf-8"));
        }

        if (!report || typeof report !== "object") continue;

        const entries = report.files
            ? Object.entries(report.files)
            : Object.entries(report).filter(([key]) => key !== "total");

        for (const [rawFilePath, data] of entries) {
            if (!data || typeof data !== "object") continue;
            const canonPath =
                canonicalizeFilePath(rawFilePath, rootDir) || rawFilePath;
            if (!isBusinessLogicSourceFile(canonPath, configExclusions)) {
                continue;
            }
            const existing = dedupedFiles.get(canonPath);
            if (
                !existing ||
                Number(data.lines?.total ?? 0) >
                    Number(existing.lines?.total ?? 0)
            ) {
                dedupedFiles.set(canonPath, data);
            }
        }
    }

    const globalTotal = {
        lines: { total: 0, covered: 0 },
        functions: { total: 0, covered: 0 },
        branches: { total: 0, covered: 0 },
        statements: { total: 0, covered: 0 },
    };

    for (const data of dedupedFiles.values()) {
        globalTotal.lines.total += Number(data.lines?.total ?? 0);
        globalTotal.lines.covered += Number(data.lines?.covered ?? 0);
        globalTotal.functions.total += Number(data.functions?.total ?? 0);
        globalTotal.functions.covered += Number(data.functions?.covered ?? 0);
        globalTotal.branches.total += Number(data.branches?.total ?? 0);
        globalTotal.branches.covered += Number(data.branches?.covered ?? 0);
        globalTotal.statements.total += Number(
            data.statements?.total ?? data.lines?.total ?? 0,
        );
        globalTotal.statements.covered += Number(
            data.statements?.covered ?? data.lines?.covered ?? 0,
        );
    }

    const calcPct = (c, t) =>
        t === 0 ? (c === 0 ? 0 : 100) : parseFloat(((c / t) * 100).toFixed(1));

    const linesPct = calcPct(
        globalTotal.lines.covered,
        globalTotal.lines.total,
    );
    const funcsPct = calcPct(
        globalTotal.functions.covered,
        globalTotal.functions.total,
    );
    let branchesPct = calcPct(
        globalTotal.branches.covered,
        globalTotal.branches.total,
    );
    if (
        (globalTotal.branches.covered === 0 ||
            globalTotal.branches.total === 0) &&
        (linesPct === 0 || globalTotal.lines.covered === 0)
    ) {
        branchesPct = 0;
    }
    const stmtsPct = calcPct(
        globalTotal.statements.covered,
        globalTotal.statements.total,
    );

    const summary = await prisma.coverageSummary.upsert({
        where: { snapshotId },
        create: { snapshotId, linesPct, branchesPct, funcsPct, stmtsPct },
        update: { linesPct, branchesPct, funcsPct, stmtsPct },
    });

    await prisma.coverageFile.deleteMany({ where: { snapshotId } });

    const parsePct = (val, fallback) => {
        if (typeof val === "number" && !isNaN(val)) return val;
        if (typeof val === "string") {
            const p = parseFloat(val);
            if (!isNaN(p)) return p;
        }
        return typeof fallback === "number" && !isNaN(fallback) ? fallback : 0;
    };

    const fileInserts = Array.from(dedupedFiles.entries()).map(
        ([filePath, data]) => {
            return {
                snapshotId,
                filePath,
                linesPct: parsePct(
                    data.lines?.pct,
                    calcPct(data.lines?.covered, data.lines?.total),
                ),
                branchesPct: parsePct(
                    data.branches?.pct,
                    calcPct(data.branches?.covered, data.branches?.total),
                ),
                funcsPct: parsePct(
                    data.functions?.pct,
                    calcPct(data.functions?.covered, data.functions?.total),
                ),
                stmtsPct: parsePct(
                    data.statements?.pct ?? data.lines?.pct,
                    calcPct(
                        data.statements?.covered ?? data.lines?.covered,
                        data.statements?.total ?? data.lines?.total,
                    ),
                ),
            };
        },
    );

    if (fileInserts.length > 0) {
        await prisma.coverageFile.createMany({ data: fileInserts });
    }

    return { summary, fileCount: fileInserts.length, filesFound: files.length };
};
