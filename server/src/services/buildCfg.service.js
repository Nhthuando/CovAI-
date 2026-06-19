import fs from 'fs';
import path from 'path';
import prisma from '../config/prisma.js';
import { randomUUID } from 'crypto';

export async function buildCfgForSnapshot(snapshotId) {
    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { storagePath: true, rootDir: true }
    });

    if (!snapshot) throw new Error('Snapshot not found');

    const rootDir = snapshot.rootDir;
    if (!rootDir || !fs.existsSync(rootDir)) throw new Error('Snapshot root directory not found');

    const files = getAllFiles(rootDir);
    const cfgRecords = [];

    for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.ts')) {
            const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
            cfgRecords.push({
                id: randomUUID(),
                snapshotId,
                filePath: relativePath,
                functionName: 'main', // Simplified for now
                graphJson: JSON.stringify({ nodes: [], edges: [] })
            });
        }
    }

    await prisma.cfg.createMany({
        data: cfgRecords,
        skipDuplicates: true
    });

    return cfgRecords.length;
}

function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
            }
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });

    return arrayOfFiles;
}