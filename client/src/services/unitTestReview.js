import { diffLines } from 'diff';

export function testReviewDiff(original = '', candidate = '') {
  const safeOrig = typeof original === 'string' ? original : String(original ?? '');
  const safeCand = typeof candidate === 'string' ? candidate : String(candidate ?? '');
  return diffLines(safeOrig, safeCand).reduce(
    (counts, part) => ({
      added: counts.added + (part.added ? part.count : 0),
      removed: counts.removed + (part.removed ? part.count : 0),
    }),
    { added: 0, removed: 0 },
  );
}

/**
 * Resolves candidate test code with resilient fallback priority:
 * 1. fullUpdatedContent (if non-empty string)
 * 2. generatedCode (if non-empty string)
 * 3. suggestedTestCode (if non-empty string)
 * 4. testCode / code (if non-empty string)
 * Returns the resolved candidate string or null if no candidate code is present.
 */
export function resolveCandidateCode(suggestion) {
  if (!suggestion || typeof suggestion !== 'object') return null;
  const candidates = [
    suggestion.fullUpdatedContent,
    suggestion.generatedCode,
    suggestion.suggestedTestCode,
    suggestion.testCode,
    suggestion.code,
  ];
  for (const code of candidates) {
    if (typeof code === 'string' && code.trim().length > 0) {
      return code;
    }
  }
  return null;
}

export function buildUnitTestReviewFiles(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return [];
  const files = new Map();

  for (const suggestion of suggestions) {
    if (!suggestion || typeof suggestion !== 'object') continue;
    const source = suggestion.sourceFile || suggestion.filePath || suggestion.sourceFilePath;
    const target = suggestion.testFile || suggestion.targetTestFile || suggestion.testFilePath;
    if (!source || !target) continue;

    const framework = suggestion.framework || 'jest';
    const key = `${target}:${framework}`;
    const rawOrig = suggestion.originalCode ?? suggestion.originalContent ?? suggestion.baseContent ?? '';
    const original = typeof rawOrig === 'string' ? rawOrig : String(rawOrig ?? '');

    const candidate = resolveCandidateCode(suggestion);
    const missing = candidate === null || (typeof candidate === 'string' && candidate.trim().length === 0);

    const existing = files.get(key);
    if (existing) {
      existing.suggestions.push(suggestion);
      const existingCandidateMissing = existing.candidateContent == null ||
        (typeof existing.candidateContent === 'string' && existing.candidateContent.trim().length === 0);

      if (existingCandidateMissing && !missing) {
        existing.candidateContent = candidate;
        existing.fullUpdatedContent = candidate;
        existing.hasChanges = candidate !== existing.originalContent;
        const counts = testReviewDiff(existing.originalContent, candidate);
        existing.linesAdded = counts.added;
        existing.linesRemoved = counts.removed;
        existing.reviewNotice = candidate === existing.originalContent
          ? 'No changes are proposed. The existing suite is preserved.'
          : null;
        existing.reviewError = null;
      } else if (!existingCandidateMissing && !missing && existing.candidateContent !== candidate) {
        existing.reviewError = 'Conflicting proposals share this test file. Regenerate one combined proposal before applying.';
      }
      continue;
    }

    const counts = missing ? { added: 0, removed: 0 } : testReviewDiff(original, candidate);
    const effectiveCandidate = candidate ?? original;

    files.set(key, {
      fileName: target,
      filePath: source,
      testFilePath: target,
      targetTestFile: target,
      originalContent: original,
      candidateContent: effectiveCandidate,
      fullUpdatedContent: effectiveCandidate,
      framework,
      suggestions: [suggestion],
      applied: ['PASSED', 'APPLIED'].includes(suggestion.status) || suggestion.applied === true,
      linesAdded: counts.added,
      linesRemoved: counts.removed,
      hasChanges: !missing && candidate !== original,
      reviewNotice: !missing && candidate === original
        ? 'No changes are proposed. The existing suite is preserved.'
        : null,
      reviewError: missing
        ? 'The complete test candidate is missing. Regenerate this proposal; a snippet cannot replace the original file.'
        : null,
      explanation: suggestion.explanation || null,
    });
  }

  return [...files.values()];
}
