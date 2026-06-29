import fs from 'fs';
import path from 'path';
import prisma from '../config/prisma.js';
import { extractFunctions } from './cyclomaticFunctionExtractor.service.js';
import { calculateComplexityFromAst } from './cyclomaticCalculator.service.js';
import { buildCFG } from './cfgBuilder.service.js';
import { storeCfg } from './cfgStorage.service.js';
import { storeComplexity } from './cyclomaticStorage.service.js';

export async function buildCfgForSnapshot(snapshotId) {
    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { storagePath: true, rootDir: true }
    });

    if (!snapshot) throw new Error('Snapshot not found');

    let rootDir = snapshot.rootDir;

    // Fallback: if rootDir is missing, try to resolve from storagePath
    if (!rootDir || !fs.existsSync(rootDir)) {
        console.warn(`[BuildCFG] rootDir not found or invalid for snapshot ${snapshotId}: "${rootDir}"`);
        
        // Try storagePath-based resolution (uploads/snapshots/<snapshotId>)
        const fallbackPath = path.join(process.cwd(), 'uploads', 'snapshots', snapshotId);
        if (fs.existsSync(fallbackPath)) {
            rootDir = fallbackPath;
            console.log(`[BuildCFG] Using fallback path: ${fallbackPath}`);
        } else {
            console.error(`[BuildCFG] Fallback path also not found: ${fallbackPath}`);
            throw new Error(`Snapshot root directory not found for ${snapshotId}. rootDir="${snapshot.rootDir}", fallback="${fallbackPath}"`);
        }
    }

    console.log(`[BuildCFG] Starting CFG build for snapshot ${snapshotId}, rootDir: ${rootDir}`);

    const files = getAllFiles(rootDir);
    let count = 0;

    console.log(`[BuildCFG] Found ${files.length} total files in ${rootDir}`);

    // Clean up existing records for this snapshot to avoid zombie records when names/logic change
    await prisma.cyclomatic.deleteMany({ where: { snapshotId } });
    await prisma.cfg.deleteMany({ where: { snapshotId } });

    for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.jsx') || file.endsWith('.tsx')) {
            const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
            const code = fs.readFileSync(file, 'utf-8');
            const functions = extractFunctions(code);

            for (const func of functions) {
                count++;
                let graphJsonStr = JSON.stringify({ nodes: [], edges: [] });
                let complexityValue = 1;

                try {
                    const cfgData = buildCFG(func.node);
                    graphJsonStr = JSON.stringify(cfgData.graphJson);
                } catch (e) {
                    console.error(`[BuildCFG] Failed to generate CFG for ${func.functionName} in ${relativePath}`);
                }

                try {
                    const complexity = calculateComplexityFromAst(func.node);
                    complexityValue = complexity.value;
                } catch (e) {
                    console.error(`[BuildCFG] Failed to calculate CC for ${func.functionName} in ${relativePath}`);
                }

                try {
                    const cfgRecord = await storeCfg({
                        snapshotId,
                        filePath: relativePath,
                        functionName: func.functionName,
                        startLine: func.startLine,
                        endLine: func.endLine,
                        graphJson: graphJsonStr
                    });

                    await prisma.cyclomatic.create({
                        data: {
                            snapshotId,
                            filePath: relativePath,
                            functionName: func.functionName,
                            value: complexityValue,
                            cfgId: cfgRecord.id
                        }
                    });
                } catch (err) {
                    console.error(`[BuildCFG] Failed to store data for ${func.functionName} in ${relativePath}:`, err);
                }
            }
        }
    }
    console.log(`[BuildCFG] Completed for snapshot ${snapshotId}: ${count} functions processed`);
    return count;
}

function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build') {
                arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
            }
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });

    return arrayOfFiles;
}