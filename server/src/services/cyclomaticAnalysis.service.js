import fs from 'fs';
import path from 'path';
import prisma from '../config/prisma.js';
import { getAllSourceFiles } from './cyclomaticFileScanner.service.js';
import { extractFunctions } from './cyclomaticFunctionExtractor.service.js';
import { calculateComplexityFromAst } from './cyclomaticCalculator.service.js';
import { storeComplexity } from './cyclomaticStorage.service.js';

export async function runCyclomaticAnalysis(snapshotId) {
    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { storagePath: true }
    });

    if (!snapshot) throw new Error('Snapshot not found');

    // Đường dẫn thực tế của code đã giải nén
    const searchPath = path.join(process.cwd(), 'uploads', 'snapshots', snapshotId);

    if (!fs.existsSync(searchPath)) {
        throw new Error(`Storage path not found: ${searchPath}`);
    }

    const files = getAllSourceFiles(searchPath);
    const results = [];

    for (const filePath of files) {
        const code = fs.readFileSync(filePath, 'utf-8');
        const functions = extractFunctions(code);
        const relativePath = path.relative(searchPath, filePath);

        for (const func of functions) {
            const complexity = calculateComplexityFromAst(func.node);
            const record = await storeComplexity({
                snapshotId,
                filePath: relativePath,
                functionName: func.functionName,
                value: complexity.value,
                decisionPoints: complexity.decisionPoints
            });
            results.push({
                ...record,
                decisionPoints: complexity.decisionPoints,
                startLine: func.startLine,
                endLine: func.endLine
            });
        }
    }

    return results;
}