import fs from 'fs';
import path from 'path';
import prisma from '../config/prisma.js';
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

    let rootDir = snapshot.rootDir;
    if (!rootDir || !fs.existsSync(rootDir)) {
        const fallbackPath = path.join(process.cwd(), 'uploads', 'snapshots', snapshotId);
        if (!fs.existsSync(fallbackPath)) throw new Error(`Snapshot root directory not found for ${snapshotId}.`);
        rootDir = fallbackPath;
    }

    const files = getAllFiles(rootDir);
    let functionCount = 0;
    await prisma.cyclomatic.deleteMany({ where: { snapshotId } });
    await prisma.cfg.deleteMany({ where: { snapshotId } });

    for (const file of files) {
        if (!/\.(js|ts|jsx|tsx)$/.test(file)) continue;
        const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
        const functions = extractFunctions(fs.readFileSync(file, 'utf-8'));

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

            const cfg = await storeCfg({
                snapshotId, filePath: relativePath, functionName: func.functionName,
                startLine: func.startLine, endLine: func.endLine, graphJson: JSON.stringify(graphJson)
            });
            await prisma.cyclomatic.create({
                data: { snapshotId, filePath: relativePath, functionName: func.functionName, value: complexity, cfgId: cfg.id }
            });
        }
    }

    console.log(`[BuildCFG] Completed for snapshot ${snapshotId}: ${functionCount} functions processed`);
    return { functionCount };
}

function getAllFiles(dirPath, files = []) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const filePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) getAllFiles(filePath, files);
        } else {
            files.push(filePath);
        }
    }
    return files;
}
