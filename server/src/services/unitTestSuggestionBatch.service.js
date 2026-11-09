import path from 'node:path';
import { assembleUnitTestCandidate, testContentHash } from './unitTestChangeSet.service.js';
import { assertUnitTestTarget } from './unitTestFilePolicy.service.js';
import { ServiceError } from '../utils/serviceError.js';

export function mergeUnitTestSuggestions(rootDir, suggestions) {
    const targets = new Map();
    for (const suggestion of suggestions) {
        if (suggestion.isFullyCovered) continue;
        const filePath = suggestion.testFile || suggestion.targetTestFile;
        if (!filePath) throw new ServiceError('The proposal has no runnable test destination. Regenerate the draft.', 422, 'INVALID_TEST_TARGET');
        const target = assertUnitTestTarget(rootDir, filePath, suggestion.framework);
        const key = path.resolve(rootDir, target.filePath);
        const code = suggestion.fullUpdatedContent || suggestion.suggestedTestCode || suggestion.generatedCode || '';
        const existing = targets.get(key);
        if (!existing) {
            targets.set(key, { ...suggestion, testFile: target.filePath, targetTestFile: target.filePath,
                sourceFiles: suggestion.sourceFiles || [suggestion.sourceFile], targetPolicy: target, fullUpdatedContent: code });
            continue;
        }
        if (existing.framework !== suggestion.framework || (existing.originalCode || '') !== (suggestion.originalCode || '')) {
            throw new ServiceError(`Conflicting proposal baselines for '${target.filePath}'. Regenerate one combined draft.`, 409, 'CONFLICTING_TEST_PROPOSALS');
        }
        const merge = assembleUnitTestCandidate({ original: existing.fullUpdatedContent, proposed: code, testFile: target.filePath });
        if (merge.needsReview.length) throw new ServiceError(`Proposals contain conflicting cases in '${target.filePath}'. Review one combined draft.`, 409, 'CONFLICTING_TEST_PROPOSALS', merge.needsReview);
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
