import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';
import { stagePreparedPublication, deferPreparedCommit } from './projectOperationWorkspace.service.js';
import { loadManifest, persistVerifiedManifest, clearManifestCache, removeEmptyParentsRecursively } from './unitTestVersion.service.js';
import { runUnitTestBatch } from './unitTestBatchRunner.service.js';
import { verifyUnitTestBatch, coverageGoalStatus } from './unitTestVerification.service.js';
import { upsertCoverageFileRows } from './coverageFilePersistence.service.js';
import { detectTestingFrameworks } from '../utils/testingFrameworkDetector.js';
import { parseExistingTestAst } from './unitTestContextEngineering.service.js';
import { findLogicSourceFiles } from './runTestsJob.service.js';
import { ensureWorkspaceNodeModulesLinked, cleanupWorkspaceNodeModulesLinks } from './dependencyResolution.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { assertUnitTestTarget } from './unitTestFilePolicy.service.js';
import { loadWorkspaceEnv, serializeEnv } from './environmentDetection.service.js';
import { computeSourceFilesHash, verifySourceFilesUnchanged } from './applyTestSuggestion.service.js';
import { canonicalizeFilePath } from '../utils/pathSanitizer.js';

export async function switchVerifiedUnitTestBatch({
    snapshot,
    projectId,
    userId,
    filePath,
    targetVersionId,
    targetVersion,
    allFiles = false,
    targetVersionType = null
}) {
    const project = await prisma.project.findUnique({where:{id:projectId},select:{workspaceRevision:true}});
    return withPreparedProjectWorkspace({ projectId,snapshotId:snapshot.id,userId,expectedWorkspaceRevision:project.workspaceRevision,
        type:'SWITCH_UNIT_TEST_VERSION',publish:result => result.success === true }, async context => {
        const rootDir = path.join(context.rootDir,context.analysisRelative);
        const manifest = structuredClone(loadManifest({snapshotId:snapshot.id,rootDir}));
        const isBulk = Boolean(allFiles || !filePath);
        let isBaseline = Number(targetVersion) === 1 || targetVersionType === 'ORIGINAL';
        if (!isBaseline && targetVersionId) {
            if (targetVersionId === 'baseline' || String(targetVersionId).startsWith('v1_')) {
                isBaseline = true;
            } else {
                for (const f of Object.values(manifest.files || {})) {
                    const v = f.versions?.find(ver => ver.versionId === targetVersionId);
                    if (v && (v.version === 1 || v.type === 'ORIGINAL')) {
                        isBaseline = true;
                        break;
                    }
                }
            }
        }

        let batch = null;
        let targetVersionNum = 1;

        if (!isBaseline) {
            if (targetVersionId) {
                batch = (manifest.batches || []).find(b => b.batchId === targetVersionId);
            }
            if (!batch && targetVersion != null) {
                batch = (manifest.batches || []).find(b => b.version === Number(targetVersion));
            }
            if (!batch && filePath) {
                const record = Object.values(manifest.files || {}).find(item => [item.testFile, item.sourceFile].includes(filePath));
                const version = record?.versions?.find(item => item.versionId === targetVersionId || item.version === Number(targetVersion));
                if (version?.batchId) {
                    batch = (manifest.batches || []).find(b => b.batchId === version.batchId);
                }
            }
            if (!batch?.fileVersions) throw new ServiceError('The selected version has no verified batch manifest', 409);
            targetVersionNum = batch.version;
        }

        const changed = [];
        const filesToProcess = (isBulk || !filePath)
            ? Object.entries(manifest.files || {})
            : Object.entries(manifest.files || {}).filter(([rel, file]) => [rel, file.testFile, file.sourceFile].includes(filePath));

        for (const [relative, file] of filesToProcess) {
            const absolute = path.resolve(rootDir,relative);
            const within = path.relative(rootDir,absolute);
            if (within.startsWith('..') || path.isAbsolute(within)) throw new ServiceError('Invalid versioned test file',400);
            assertUnitTestTarget(rootDir, relative, file.framework || null);

            const baseline = file.baseline || {
                exists: !file.isNewFile && Boolean(file.versions?.find(item => item.type === 'ORIGINAL')?.content),
                content: file.versions?.find(item => item.type === 'ORIGINAL')?.content || ''
            };

            if (isBaseline) {
                // Baseline rollback: restore original baseline content or unlink newly created test file
                if (!baseline.exists || !baseline.content || file.isNewFile) {
                    if (fs.existsSync(absolute)) {
                        fs.unlinkSync(absolute);
                        removeEmptyParentsRecursively(absolute, [rootDir, context.originalRootDir].filter(Boolean));
                    }
                } else {
                    fs.mkdirSync(path.dirname(absolute), { recursive: true });
                    fs.writeFileSync(absolute, baseline.content, 'utf8');
                }
                const v1 = file.versions?.find(item => item.version === 1 || item.type === 'ORIGINAL');
                if (file.versions) {
                    file.versions.forEach(item => { item.isActive = (item === v1); });
                }
                file.currentVersion = 1;
                changed.push({ testFile: relative, sourceFile: file.sourceFile, switchedToVersion: 1 });
            } else {
                // Batch rollback: restore batch file version or revert to baseline if not in batch
                const selected = batch.fileVersions?.[relative]
                    ? file.versions?.find(item => item.versionId === batch.fileVersions[relative])
                    : null;

                if (batch.fileVersions?.[relative] && !selected) {
                    throw new ServiceError('A test artifact in this version has expired; the active version was not changed', 410);
                }

                if (selected) {
                    fs.mkdirSync(path.dirname(absolute), { recursive: true });
                    fs.writeFileSync(absolute, selected.content, 'utf8');
                    file.versions?.forEach(item => { item.isActive = (item === selected); });
                    file.currentVersion = selected.version;
                    changed.push({ testFile: relative, sourceFile: file.sourceFile, switchedToVersion: file.currentVersion });
                } else {
                    // File not in this batch: revert to baseline or unlink newly created test file
                    if (!baseline.exists || !baseline.content || file.isNewFile) {
                        if (fs.existsSync(absolute)) {
                            fs.unlinkSync(absolute);
                            removeEmptyParentsRecursively(absolute, [rootDir, context.originalRootDir].filter(Boolean));
                        }
                    } else {
                        fs.mkdirSync(path.dirname(absolute), { recursive: true });
                        fs.writeFileSync(absolute, baseline.content, 'utf8');
                    }
                    const v1 = file.versions?.find(item => item.version === 1 || item.type === 'ORIGINAL');
                    if (file.versions) {
                        file.versions.forEach(item => { item.isActive = (item === v1); });
                    }
                    file.currentVersion = 1;
                    changed.push({ testFile: relative, sourceFile: file.sourceFile, switchedToVersion: 1 });
                }
            }
        }

        if (isBaseline) {
            manifest.activeBatchId = null;
        } else {
            manifest.activeBatchId = batch.batchId;
        }

        const environment = await loadWorkspaceEnv(snapshot.rootDir);
        const envPath = path.join(rootDir,'.env');
        if (Object.keys(environment.variables || {}).length) fs.writeFileSync(envPath,serializeEnv('',environment.variables),{mode:0o600});
        const sourceHashes = computeSourceFilesHash(rootDir);
        const links = ensureWorkspaceNodeModulesLinked(snapshot.rootDir,rootDir);
        const runId = crypto.randomUUID();
        const coverageDir = path.join(rootDir,'coverage','rollback',runId);
        try {
            const testFiles = detectTestingFrameworks(rootDir).testFiles.filter(file => ['jest','vitest'].includes(file.framework)).map(file => file.path);
            const targetSourceFiles = findLogicSourceFiles(rootDir,{bypassCache:true}).map(file => file.relativePath || file.filePath).filter(Boolean);

            let results;
            let summary;
            let verification;
            let runnerOutput = '';

            if (testFiles.length === 0) {
                // Clean fallback for repos with zero baseline unit test files
                results = { success: true, numFailedTestSuites: 0, testResults: [] };
                summary = {
                    total: {
                        statements: { total: 0, covered: 0, pct: 0 },
                        branches: { total: 0, covered: 0, pct: 0 },
                        functions: { total: 0, covered: 0, pct: 0 },
                        lines: { total: 0, covered: 0, pct: 0 }
                    }
                };
                for (const src of targetSourceFiles) {
                    const normSrc = src.replace(/\\/g, '/');
                    summary[normSrc] = {
                        statements: { total: 0, covered: 0, pct: 0 },
                        branches: { total: 0, covered: 0, pct: 0 },
                        functions: { total: 0, covered: 0, pct: 0 },
                        lines: { total: 0, covered: 0, pct: 0 }
                    };
                }
                verification = { valid: true, reasons: [], perFile: [], totalTests: 0, passedTests: 0, failedTests: 0 };
            } else {
                const result = await runUnitTestBatch({rootDir,snapshot,testFiles,targetSourceFiles,coverageDir});
                runnerOutput = result.stdout || result.stderr || '';
                const readReport = name => {try {return JSON.parse(fs.readFileSync(path.join(coverageDir,name),'utf8'));} catch {return null;}};
                results = readReport('test-results.json');
                summary = readReport('coverage-summary.json');
                const allowedSkippedByFile = Object.fromEntries(testFiles.map(file => [file,parseExistingTestAst(fs.readFileSync(path.join(rootDir,file),'utf8'),file).tests.filter(test => test.isSkipped).map(test => test.runnerTitle || test.fullTitle || test.title)]));
                verification = verifyUnitTestBatch({rootDir,testFiles,results,exitCode:result.exitCode,allowedSkippedByFile});
            }

            cleanupWorkspaceNodeModulesLinks(links);
            if (!verification.valid || coverageGoalStatus(summary?.total) === 'UNAVAILABLE' || !verifySourceFilesUnchanged(rootDir,sourceHashes).intact) return {success:false,status:'FAILED',message:'The target version failed verification; the active version is unchanged.',verification,
                errorDetail: runnerOutput || 'The runner did not produce valid test and coverage reports.'};
            const coverageRows = [];
            for (const [file, metrics] of Object.entries(summary)) if (file !== 'total') {
                if (coverageGoalStatus(metrics) === 'UNAVAILABLE') throw new ServiceError(`Invalid coverage counters for ${file}; the active version is unchanged.`,422);
                const rawPath = path.isAbsolute(file) ? path.relative(rootDir,file).replaceAll('\\','/') : file;
                const filePath = canonicalizeFilePath(rawPath, rootDir) || rawPath.replaceAll('\\','/');
                coverageRows.push({snapshotId:snapshot.id,filePath,stmtsPct:metrics.statements.pct,branchesPct:metrics.branches.pct,funcsPct:metrics.functions.pct,linesPct:metrics.lines.pct});
            }
            manifest.lastVerification = {runId,verifiedAt:new Date().toISOString(),coverage:summary.total};
            persistVerifiedManifest({snapshotId:snapshot.id,rootDir,manifest});
            await stagePreparedPublication(async tx => {
                const values = {stmtsPct:summary.total.statements.pct,branchesPct:summary.total.branches.pct,funcsPct:summary.total.functions.pct,linesPct:summary.total.lines.pct};
                await tx.coverageSummary.upsert({where:{snapshotId:snapshot.id},update:values,create:{snapshotId:snapshot.id,...values}});
                await upsertCoverageFileRows(tx,coverageRows);
            });
            deferPreparedCommit(() => clearManifestCache(snapshot.id));
            return {success:true,switchedCount:changed.length,files:changed,targetVersion:targetVersionNum,activeBatchId:manifest.activeBatchId,runId,backgroundJob:null};
        } finally {cleanupWorkspaceNodeModulesLinks(links);if(fs.existsSync(envPath))fs.unlinkSync(envPath);}
    });
}
