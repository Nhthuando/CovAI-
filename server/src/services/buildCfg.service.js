import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import {operationSnapshot,stagePreparedPublication} from './projectOperationWorkspace.service.js';
import { extractFunctions } from './cyclomaticFunctionExtractor.service.js';
import { calculateComplexityFromAst } from './cyclomaticCalculator.service.js';
import { buildCFG } from './cfgBuilder.service.js';
import { storeCfg } from './cfgStorage.service.js';

/** CFG pipeline stage: generates CFG and cyclomatic artifacts only. */
export async function buildCfgForSnapshot(snapshotId) {
    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { rootDir: true }
    });
    if (!snapshot) throw new Error('Snapshot not found');

    let rootDir = operationSnapshot({id:snapshotId,...snapshot}).rootDir;
    if (!rootDir || !fs.existsSync(rootDir)) {
        const fallbackPath = path.join(process.cwd(), 'uploads', 'snapshots', snapshotId);
        if (!fs.existsSync(fallbackPath)) throw new Error(`Snapshot root directory not found for ${snapshotId}.`);
        rootDir = fallbackPath;
    }

    const files = getAllFiles(rootDir);
    let functionCount = 0;
    const artifacts = new Map();

    for (const file of files) {
        if (!/\.(js|ts|jsx|tsx)$/.test(file)) continue;
        const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
        const functions = extractFunctions(fs.readFileSync(file, 'utf-8'));
        const seenInFile = new Set();

        for (const func of functions) {
            functionCount++;
            let graphJson = { nodes: [], edges: [] };
            let complexity = 1;
            try { graphJson = buildCFG(func.node).graphJson; } catch (error) {
                console.error(`[BuildCFG] Failed to generate CFG for ${func.functionName} in ${relativePath}`);
            }
            try { complexity = calculateComplexityFromAst(func.node).value; } catch (error) {
                console.error(`[BuildCFG] Failed to calculate complexity for ${func.functionName} in ${relativePath}`);
            }

            let uniqueName = func.functionName;
            if (seenInFile.has(uniqueName)) {
                uniqueName = `${func.functionName}@L${func.startLine || 1}`;
            }
            seenInFile.add(uniqueName);

            artifacts.set(JSON.stringify([relativePath, uniqueName]), { cfg: {
                id: randomUUID(),
                snapshotId,
                filePath: relativePath,
                functionName: uniqueName,
                startLine: func.startLine,
                endLine: func.endLine,
                graphJson: JSON.stringify(graphJson),
            }, complexity });
        }
    }

    // Graph construction and JSON serialization finish before opening the
    // publication transaction. Insert linked artifacts in bounded batches.
    await stagePreparedPublication(async tx => {
        await tx.cyclomatic.deleteMany({ where: { snapshotId } });
        await tx.cfg.deleteMany({ where: { snapshotId } });
        const rows = [...artifacts.values()];
        for (let offset = 0; offset < rows.length; offset += 500) {
            const batch = rows.slice(offset, offset + 500);
            if (typeof tx.cfg.createMany === 'function' && typeof tx.cyclomatic.createMany === 'function') {
                await tx.cfg.createMany({ data: batch.map(row => row.cfg) });
                await tx.cyclomatic.createMany({ data: batch.map(({ cfg, complexity }) => ({ snapshotId,
                    filePath: cfg.filePath, functionName: cfg.functionName, value: complexity, cfgId: cfg.id })) });
            } else {
                for (const { cfg: data, complexity } of batch) {
                    const cfg = await storeCfg({ ...data, skipSnapshotCheck: true }, tx);
                    const value = { snapshotId, filePath: data.filePath, functionName: data.functionName, value: complexity, cfgId: cfg.id };
                    await tx.cyclomatic.upsert({ where: { snapshotId_filePath_functionName: { snapshotId, filePath: data.filePath, functionName: data.functionName } }, create: value, update: { value: complexity, cfgId: cfg.id } });
                }
            }
        }
    });

    console.log(`[BuildCFG] Completed for snapshot ${snapshotId}: ${functionCount} functions processed`);
    return { functionCount };
}

function getAllFiles(dirPath, files = []) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const filePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (!['node_modules', '.git', '.covai-collaboration', '.covai-temp', '.covai-system-test', 'dist', 'build', 'coverage'].includes(entry.name)) getAllFiles(filePath, files);
        } else {
            files.push(filePath);
        }
    }
    return files;
}
