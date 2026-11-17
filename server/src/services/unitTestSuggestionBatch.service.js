import fs from 'node:fs';
import path from 'node:path';
import { assembleUnitTestCandidate, testContentHash } from './unitTestChangeSet.service.js';
import { assertUnitTestTarget, suggestUnitTestTarget } from './unitTestFilePolicy.service.js';
import { ServiceError } from '../utils/serviceError.js';

export function mergeUnitTestSuggestions(rootDir, suggestions, rejected = []) {
    function separateCandidate(suggestion, target, code) {
        const sourceFile = suggestion.sourceFile || target.filePath;
        const original = suggestion.originalCode || '';
        try {
            if (original.trim() || fs.existsSync(path.resolve(rootDir, target.filePath))) {
                throw new ServiceError('Conflicting changes modify an existing suite. Review one combined draft.', 422, 'INVALID_TEST_TARGET');
            }
            const sameDirectory = path.posix.dirname(target.filePath);
            const excluded = new Set([...targets.values()].map(item => item.testFile));
            const alternative = suggestUnitTestTarget(rootDir, sourceFile, suggestion.framework || target.framework, null,
                { excluded, sameDirectory, newOnly: true });
            const targetPolicy = assertUnitTestTarget(rootDir, alternative, suggestion.framework || target.framework);
            targets.set(path.resolve(rootDir, alternative), { ...suggestion, testFile: alternative, targetTestFile: alternative,
                fullUpdatedContent: code, targetPolicy, changeSet: { ...suggestion.changeSet, testFile: alternative },
                ...(suggestion.qualityGate && { qualityGate: { ...suggestion.qualityGate,
                    cases: (suggestion.qualityGate.cases || []).map(item => ({ ...item, testFile: alternative })),
                    findings: (suggestion.qualityGate.findings || []).map(item => ({ ...item, testFile: alternative })) } }) });
        } catch (error) {
            rejected.push({ filePath: sourceFile, testFile: target.filePath, status: 'FAILED',
                classification: 'INVALID_TEST_TARGET', message: error.message });
        }
    }
    const targets = new Map();
    for (const suggestion of suggestions) {
        if (suggestion.isFullyCovered) continue;
        const filePath = suggestion.testFile || suggestion.targetTestFile;
        let target;
        try {
            target = assertUnitTestTarget(rootDir, filePath, suggestion.framework);
        } catch (error) {
            if (error.code !== 'INVALID_TEST_TARGET') throw error;
            rejected.push({ filePath: suggestion.sourceFile, testFile: filePath, status: 'FAILED',
                classification: 'INVALID_TEST_TARGET', message: error.message });
            continue;
        }
        const key = path.resolve(rootDir, target.filePath);
        const code = suggestion.fullUpdatedContent || suggestion.suggestedTestCode || suggestion.generatedCode || '';
        const existing = targets.get(key);
        if (!existing) {
            targets.set(key, { ...suggestion, testFile: target.filePath, targetTestFile: target.filePath,
                sourceFiles: suggestion.sourceFiles || [suggestion.sourceFile], targetPolicy: target, fullUpdatedContent: code });
            continue;
        }
        if (existing.sourceFile !== suggestion.sourceFile && !existing.originalCode?.trim() &&
            !suggestion.originalCode?.trim() && !fs.existsSync(key)) {
            separateCandidate(suggestion, target, code);
            continue;
        }
        if (existing.framework !== suggestion.framework || (existing.originalCode || '') !== (suggestion.originalCode || '')) {
            separateCandidate(suggestion, target, code);
            continue;
        }
        let merge;
        try {
            merge = assembleUnitTestCandidate({ original: existing.fullUpdatedContent, proposed: code, testFile: target.filePath });
        } catch {
            separateCandidate(suggestion, target, code);
            continue;
        }
        if (merge.needsReview?.length) {
            separateCandidate(suggestion, target, code);
            continue;
        }
        existing.fullUpdatedContent = merge.content;
        existing.sourceFiles.push(suggestion.sourceFile);
        existing.sourceBindings = [...(existing.sourceBindings || [{filePath:existing.sourceFile,hash:existing.sourceSha256}]),
            {filePath:suggestion.sourceFile,hash:suggestion.sourceSha256}].filter(binding => binding.hash);
        existing.sourceSha256 = undefined;
    }
    return [...targets.values()].map(suggestion => {
        const content = suggestion.fullUpdatedContent;
        return { ...suggestion, generatedCode: content, suggestedTestCode: content, testCode: content,
            changeSet: { ...suggestion.changeSet, candidateHash: testContentHash(content) } };
    });
}
