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
 * Normalizes a test file path consistently with backend `normalizeLockKey`:
 * - converts backslashes to forward slashes and collapses repeated slashes
 * - strips storage / repo / upload / Windows drive prefixes
 * - resolves `.` and `..` segments cleanly
 * Returns `{ displayPath, groupKey }` where `groupKey` is lowercased for conflict grouping.
 */
const KNOWN_UPLOAD_ROOT_DIRS = new Set([
  'tests',
  '__tests__',
  'test',
  'spec',
  'src',
  'server',
  'client',
  'packages',
  'apps',
  'lib',
  'e2e',
  'integration',
  'unit',
]);

export function normalizeReviewTestFile(rawPath = '') {
  if (!rawPath || typeof rawPath !== 'string') {
    return { displayPath: '', groupKey: '' };
  }

  let normalized = rawPath.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) {
    return { displayPath: '', groupKey: '' };
  }

  const containerOnlyPattern =
    /^(?:(?:\.\/)?repo|(?:[a-zA-Z]:)?\/(?:.*\/)?repo|(?:.*\/)?uploads\/snapshots\/[^/]+|(?:.*\/)?storage\/projects\/[^/]+(?:\/snapshots\/[^/]+(?:\/coverage)?)?)\/?$/i;
  if (containerOnlyPattern.test(normalized)) {
    return { displayPath: '', groupKey: '' };
  }

  const repoMatch =
    normalized.match(/^(?:[a-zA-Z]:)?\/(?:.*\/)?repo\/(.+)$/i) ||
    normalized.match(/^(?:\.\/)?repo\/(.+)$/i) ||
    normalized.match(/(?:^|\/)storage\/projects\/[^/]+(?:\/snapshots\/[^/]+(?:\/coverage)?)?\/repo\/(.+)$/i) ||
    normalized.match(/(?:^|\/)uploads\/snapshots\/[^/]+(?:\/[^/]+)?\/repo\/(.+)$/i);

  if (repoMatch) {
    normalized = repoMatch[1];
  } else {
    const uploadMatch = normalized.match(/(?:^|\/)uploads\/snapshots\/[^/]+\/(.+)$/i);
    const storageSnapshotMatch = normalized.match(/(?:^|\/)storage\/projects\/[^/]+\/snapshots\/[^/]+(?:\/coverage)?\/(.+)$/i);
    const storageMatch = normalized.match(/(?:^|\/)storage\/projects\/[^/]+\/(.+)$/i);

    if (uploadMatch) {
      const afterSnap = uploadMatch[1];
      const slashIdx = afterSnap.indexOf('/');
      if (slashIdx !== -1) {
        const firstSeg = afterSnap.slice(0, slashIdx).toLowerCase();
        normalized = KNOWN_UPLOAD_ROOT_DIRS.has(firstSeg) ? afterSnap : afterSnap.slice(slashIdx + 1);
      } else {
        normalized = afterSnap;
      }
    } else if (storageSnapshotMatch) {
      normalized = storageSnapshotMatch[1];
    } else if (storageMatch) {
      normalized = storageMatch[1];
    }
  }

  normalized = normalized.replace(/^[a-zA-Z]:\//, '').replace(/^\/+/, '');

  const resolvedSegments = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop();
      }
      continue;
    }
    resolvedSegments.push(segment);
  }

  const displayPath = resolvedSegments.join('/');
  return {
    displayPath,
    groupKey: displayPath.toLowerCase(),
  };
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

const MISSING_CANDIDATE_ERROR =
  'The complete test candidate is missing. Regenerate this proposal; a snippet cannot replace the original file.';
const FRAMEWORK_CONFLICT_ERROR =
  'Conflicting proposals with different frameworks share this test file. Review or regenerate one combined proposal before applying.';
const PROPOSAL_CONFLICT_ERROR =
  'Conflicting proposals share this test file. Regenerate one combined proposal before applying.';
const NO_CHANGES_NOTICE = 'No changes are proposed. The existing suite is preserved.';

function isSuggestionApplied(suggestion) {
  if (!suggestion || typeof suggestion !== 'object') return false;
  if (suggestion.applied === false || suggestion.status === 'VERIFIED_DRAFT') return false;
  return suggestion.applied === true || ['PASSED', 'APPLIED'].includes(suggestion.status);
}

function collectIsolatedDefectsFromSuggestions(suggestions) {
  const seen = new Set();
  const defects = [];
  for (const s of suggestions) {
    const list = Array.isArray(s?.isolatedDefects) && s.isolatedDefects.length > 0
      ? s.isolatedDefects
      : (s?.status === 'ISOLATED' && Array.isArray(s?.qualityGate?.isolatedDefects)
        ? s.qualityGate.isolatedDefects
        : []);
    for (const d of list) {
      if (!d || typeof d !== 'object') continue;
      const sig = `${d.symbol || ''}:${d.file || ''}:${d.line || ''}:${d.diagnostic || ''}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      defects.push(d);
    }
  }
  return defects;
}

export function formatIsolatedDefectsDiagnostic(defects) {
  if (!Array.isArray(defects) || defects.length === 0) return null;
  const parts = defects.map((d) => {
    const location = d.file ? `${d.file}${d.line ? `:${d.line}` : ''}` : '';
    const symbolLabel = d.symbol ? `${d.symbol}${location ? ` (${location})` : ''}` : location;
    const detail = d.diagnostic || d.reason || d.message || 'Unfixable target source defect';
    return symbolLabel ? `${symbolLabel}: ${detail}` : detail;
  });
  return `Isolated target source defect(s): ${parts.join('; ')}`;
}

function computeReviewNotice({ hasChanges, isolatedDefects, suggestions }) {
  const defectNotice = formatIsolatedDefectsDiagnostic(isolatedDefects);
  if (defectNotice) {
    return hasChanges === false ? `${defectNotice}. ${NO_CHANGES_NOTICE}` : defectNotice;
  }
  if (suggestions.some((s) => s?.status === 'ISOLATED')) {
    return 'One or more test cases for this file were isolated due to a target source defect.';
  }
  if (hasChanges === false) {
    return NO_CHANGES_NOTICE;
  }
  return null;
}

export function buildUnitTestReviewFiles(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return [];
  const files = new Map();
  const metaByKey = new Map();

  for (const suggestion of suggestions) {
    if (!suggestion || typeof suggestion !== 'object') continue;
    const source = suggestion.sourceFile || suggestion.filePath || suggestion.sourceFilePath;
    const target = suggestion.testFile || suggestion.targetTestFile || suggestion.testFilePath;
    if (typeof source !== 'string' || !source.trim() || typeof target !== 'string' || !target.trim()) continue;

    const { displayPath, groupKey } = normalizeReviewTestFile(target);
    if (!groupKey || !displayPath) continue;
    const resolvedTarget = displayPath;
    const key = groupKey;

    const framework = suggestion.framework || 'jest';
    const rawOrig = suggestion.originalCode ?? suggestion.originalContent ?? suggestion.baseContent ?? '';
    const original = typeof rawOrig === 'string' ? rawOrig : String(rawOrig ?? '');

    const candidate = resolveCandidateCode(suggestion);
    const missing = candidate === null || (typeof candidate === 'string' && candidate.trim().length === 0);
    const repairsKey = JSON.stringify(suggestion.testRepairs ?? null);

    const existing = files.get(key);
    if (existing) {
      const meta = metaByKey.get(key);
      existing.suggestions.push(suggestion);
      existing.applied = existing.suggestions.every(isSuggestionApplied);
      existing.isolated = existing.suggestions.every((s) => s?.status === 'ISOLATED');
      existing.isolatedDefects = collectIsolatedDefectsFromSuggestions(existing.suggestions);
      const itemHasChanges = !missing && candidate !== original;
      existing.hasChanges = existing.hasChanges || itemHasChanges;

      if (meta.framework !== framework) {
        existing.reviewError = FRAMEWORK_CONFLICT_ERROR;
      } else if (
        existing.reviewError !== FRAMEWORK_CONFLICT_ERROR &&
        (
          meta.hasMissingCandidate ||
          missing ||
          existing.originalContent !== original ||
          meta.candidate !== candidate ||
          meta.repairsKey !== repairsKey
        )
      ) {
        if (
          meta.hasMissingCandidate &&
          missing &&
          existing.originalContent === original &&
          meta.repairsKey === repairsKey
        ) {
          existing.reviewError = MISSING_CANDIDATE_ERROR;
        } else {
          existing.reviewError = PROPOSAL_CONFLICT_ERROR;
        }
      }

      existing.reviewNotice = existing.reviewError
        ? formatIsolatedDefectsDiagnostic(existing.isolatedDefects) || null
        : computeReviewNotice({
            hasChanges: existing.hasChanges,
            isolatedDefects: existing.isolatedDefects,
            suggestions: existing.suggestions,
          });
      continue;
    }

    const counts = missing ? { added: 0, removed: 0 } : testReviewDiff(original, candidate);
    const effectiveCandidate = candidate ?? original;
    const hasChanges = !missing && candidate !== original;
    const isolatedDefects = collectIsolatedDefectsFromSuggestions([suggestion]);

    metaByKey.set(key, {
      framework,
      candidate,
      repairsKey,
      hasMissingCandidate: missing,
    });

    files.set(key, {
      key,
      fileName: resolvedTarget,
      filePath: source,
      testFilePath: resolvedTarget,
      targetTestFile: resolvedTarget,
      originalContent: original,
      candidateContent: effectiveCandidate,
      fullUpdatedContent: effectiveCandidate,
      framework,
      suggestions: [suggestion],
      applied: isSuggestionApplied(suggestion),
      isolated: suggestion.status === 'ISOLATED',
      isolatedDefects,
      linesAdded: counts.added,
      linesRemoved: counts.removed,
      hasChanges,
      reviewNotice: missing
        ? formatIsolatedDefectsDiagnostic(isolatedDefects) || null
        : computeReviewNotice({
            hasChanges,
            isolatedDefects,
            suggestions: [suggestion],
          }),
      reviewError: missing ? MISSING_CANDIDATE_ERROR : null,
      explanation: suggestion.explanation || null,
    });
  }

  return [...files.values()];
}

const EXCLUDED_UNAPPLIED_STATUSES = new Set([
  'PASSED',
  'APPLIED',
  'REJECTED',
  'ISOLATED',
  'NO_CHANGES',
  'FULLY_COVERED',
]);

export function collectUnappliedReviewSuggestions(reviewFiles) {
  if (!Array.isArray(reviewFiles) || reviewFiles.length === 0) return [];
  const collected = [];
  const seenKeys = new Set();

  for (const file of reviewFiles) {
    if (!file || file.applied || file.reviewError || file.hasChanges === false) continue;
    const fileSuggestions = Array.isArray(file.suggestions) && file.suggestions.length > 0
      ? file.suggestions
      : [file];

    for (const s of fileSuggestions) {
      if (!s || typeof s !== 'object') continue;
      if (s.applied === true || s.isFullyCovered === true) continue;
      if (EXCLUDED_UNAPPLIED_STATUSES.has(s.status)) continue;
      const candidate = resolveCandidateCode(s);
      if (!candidate) continue;

      const sId = s.suggestionId || s.id;
      const normTarget = normalizeReviewTestFile(
        s.testFile || s.targetTestFile || s.testFilePath || file.testFilePath || '',
      ).groupKey;
      const dedupeKey = sId
        ? `id:${sId}:${normTarget}`
        : `shape:${normTarget}:${s.framework || file.framework || 'jest'}:${candidate}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      collected.push({
        ...s,
        sourceFile: s.sourceFile || s.filePath || s.sourceFilePath || file.filePath,
        testFile: s.testFile || s.targetTestFile || s.testFilePath || file.testFilePath,
      });
    }
  }

  return collected;
}

function matchSuggestionIsolatedDefects(matchedItem, suggestion, globalDefects, topStatus) {
  if (Array.isArray(matchedItem?.isolatedDefects) && matchedItem.isolatedDefects.length > 0) {
    return matchedItem.isolatedDefects;
  }
  if (!Array.isArray(globalDefects) || globalDefects.length === 0) {
    return null;
  }

  const itemTestKey = normalizeReviewTestFile(
    matchedItem?.testFile || suggestion?.testFile || suggestion?.targetTestFile || '',
  ).groupKey;
  const itemSourceKey = normalizeReviewTestFile(
    suggestion?.sourceFile || suggestion?.filePath || '',
  ).groupKey;

  const filtered = globalDefects.filter((d) => {
    if (!d || typeof d !== 'object') return false;
    const defectTestKey = normalizeReviewTestFile(d.testFile || '').groupKey;
    const defectFileKey = normalizeReviewTestFile(d.file || '').groupKey;
    if (itemTestKey && defectTestKey && itemTestKey === defectTestKey) return true;
    if (itemSourceKey && defectFileKey && itemSourceKey === defectFileKey) return true;
    return false;
  });

  if (filtered.length > 0) return filtered;
  if (matchedItem?.status === 'ISOLATED' || topStatus === 'PARTIAL') {
    return globalDefects;
  }
  return null;
}

function pickBestTestFileMatch(items, suggestion, normalizePath) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const sId = suggestion?.suggestionId || suggestion?.id || null;
  if (sId) {
    const idExact = items.find((item) => (item?.suggestionId || item?.id) === sId);
    if (idExact) return idExact;
  }

  const sugSourceKey = normalizePath(
    suggestion?.sourceFile || suggestion?.filePath || suggestion?.sourceFilePath || '',
  );
  if (sugSourceKey) {
    const sourceExact = items.find((item) => {
      const itemSourceKey = normalizePath(item?.sourceFile || item?.filePath || '');
      return itemSourceKey && itemSourceKey === sugSourceKey;
    });
    if (sourceExact) return sourceExact;
  }

  const eligible = items.filter((item) => {
    const itemId = item?.suggestionId || item?.id || null;
    return !sId || !itemId || itemId === sId;
  });
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  return (
    eligible.find((item) => item?.status === 'FAILED') ||
    eligible.find((item) => item?.status === 'ISOLATED') ||
    eligible[0]
  );
}

export function applyBatchResultToSuggestionsMap(prevMap, batchIds, result, options = {}) {
  if (!prevMap || typeof prevMap !== 'object') return {};
  const rawIds = batchIds instanceof Set ? [...batchIds] : (Array.isArray(batchIds) ? batchIds : []);
  const idSet = new Set(rawIds.filter((id) => (typeof id === 'string' ? id.trim().length > 0 : Boolean(id))));
  if (idSet.size === 0) return prevMap;

  const normalizePath = typeof options?.normalizePath === 'function'
    ? options.normalizePath
    : (p) => normalizeReviewTestFile(p).groupKey;

  const appliedList = Array.isArray(result?.appliedSuggestions) ? result.appliedSuggestions : [];
  const byId = new Map();
  const byTestFile = new Map();
  for (const item of appliedList) {
    if (!item || typeof item !== 'object') continue;
    const itemId = item.suggestionId || item.id;
    const tfKey = normalizePath(item.testFile || item.targetTestFile || '');
    if (itemId) {
      if (!byId.has(itemId)) byId.set(itemId, []);
      byId.get(itemId).push({ item, tfKey });
    }
    if (tfKey) {
      if (!byTestFile.has(tfKey)) byTestFile.set(tfKey, []);
      byTestFile.get(tfKey).push(item);
    }
  }

  const qualityGate = result?.qualityGate;
  const globalDefects = Array.isArray(qualityGate?.isolatedDefects) ? qualityGate.isolatedDefects : [];
  const globalMissingDependencies =
    result?.missingDependencies ?? (result?.missingDependency ? [result.missingDependency] : undefined);
  const topStatus = result?.status || null;
  const isNoChanges = topStatus === 'NO_CHANGES';
  const isTopSuccess = result?.success === true && topStatus !== 'FAILED';
  const fallbackError =
    result?.errorDetail ||
    result?.testRunError ||
    result?.message ||
    (!isTopSuccess ? 'Batch verification failed. The active version is unchanged.' : null);

  return Object.fromEntries(
    Object.entries(prevMap).map(([filePath, list]) => [
      filePath,
      (list || []).map((s) => {
        const sId = s?.suggestionId || s?.id;
        if (!sId || !idSet.has(sId)) return s;

        const tfKey = normalizePath(s?.testFile || s?.targetTestFile || '');
        const idEntries = byId.get(sId) || [];
        let matchedItem = null;
        if (idEntries.length > 0) {
          const exactEntry = tfKey ? idEntries.find((entry) => entry.tfKey && entry.tfKey === tfKey) : null;
          const untypedEntry = idEntries.find((entry) => !entry.tfKey || !tfKey);
          matchedItem = (exactEntry || untypedEntry)?.item || null;
        }
        if (!matchedItem && tfKey && byTestFile.has(tfKey)) {
          matchedItem = pickBestTestFileMatch(byTestFile.get(tfKey), s, normalizePath);
        }

        // Guard against duplicate suggestionId across distinct files when only one file appeared in appliedSuggestions.
        const idMatchedOnlyOtherFile =
          !matchedItem &&
          appliedList.length > 0 &&
          Boolean(tfKey) &&
          idEntries.length > 0 &&
          idEntries.every((entry) => entry.tfKey && entry.tfKey !== tfKey);
        if (idMatchedOnlyOtherFile) {
          return {
            ...s,
            status: s.status === 'APPLYING' ? 'GENERATED' : s.status,
            applied: Boolean(s.applied),
          };
        }

        let itemStatus;
        if (
          isNoChanges &&
          result?.success !== false &&
          matchedItem?.status !== 'FAILED' &&
          matchedItem?.status !== 'ISOLATED'
        ) {
          itemStatus = 'NO_CHANGES';
        } else {
          const rawStatus = matchedItem?.status || (isTopSuccess ? 'PASSED' : 'FAILED');
          if (result?.fileUpdated === false && !isNoChanges) {
            if (topStatus === 'VERIFIED_DRAFT' || rawStatus === 'PASSED' || rawStatus === 'APPLIED') {
              itemStatus = 'VERIFIED_DRAFT';
            } else {
              itemStatus = rawStatus;
            }
          } else {
            itemStatus = rawStatus;
          }
        }

        const isPassed = itemStatus === 'PASSED' || itemStatus === 'APPLIED';
        const isIsolated = itemStatus === 'ISOLATED';
        const isFailed = itemStatus === 'FAILED';

        const itemDefects = matchSuggestionIsolatedDefects(matchedItem, s, globalDefects, topStatus);
        const defectText = formatIsolatedDefectsDiagnostic(itemDefects);

        let testRunError = null;
        if (isFailed) {
          testRunError = matchedItem?.error || fallbackError || defectText || 'Test verification failed.';
        } else if (isIsolated) {
          testRunError = matchedItem?.error || defectText || 'Test isolated due to a target source defect.';
        }

        const missingDependency = (isPassed || itemStatus === 'NO_CHANGES' || itemStatus === 'VERIFIED_DRAFT')
          ? null
          : (matchedItem?.missingDependency ||
            result?.missingDependency ||
            result?.moduleResolutionError?.missingDependency ||
            null);

        return {
          ...s,
          status: itemStatus,
          applied: Boolean(result?.fileUpdated && isPassed),
          testRunError,
          isolatedDefects: itemDefects,
          missingDependency,
          missingDependencies: isFailed ? (matchedItem?.missingDependencies ?? globalMissingDependencies) : undefined,
          qualityGate: qualityGate || s.qualityGate,
        };
      }),
    ]),
  );
}

export function summarizeApplyBatchResult(result, batchCount = 0) {
  const appliedList = Array.isArray(result?.appliedSuggestions) ? result.appliedSuggestions : [];
  const topStatus = result?.status || null;
  const isNoChanges = topStatus === 'NO_CHANGES';

  let passedCount = 0;
  let failedCount = 0;
  let isolatedCount = 0;

  if (appliedList.length > 0) {
    for (const item of appliedList) {
      if (!item || typeof item !== 'object') continue;
      if (isNoChanges && item.status !== 'FAILED' && item.status !== 'ISOLATED') continue;
      if (item.status === 'PASSED' || item.status === 'APPLIED') passedCount += 1;
      else if (item.status === 'ISOLATED') isolatedCount += 1;
      else if (item.status === 'FAILED') failedCount += 1;
    }
  } else if (!isNoChanges) {
    if (result?.success === true && topStatus !== 'FAILED') {
      passedCount = batchCount;
    } else {
      failedCount = batchCount;
    }
  }

  const defectSeen = new Set();
  const isolatedDefects = [];
  const pushDefect = (d) => {
    if (!d || typeof d !== 'object') return;
    const sig = `${d.symbol || ''}:${d.file || ''}:${d.line || ''}:${d.diagnostic || ''}`;
    if (defectSeen.has(sig)) return;
    defectSeen.add(sig);
    isolatedDefects.push(d);
  };

  if (Array.isArray(result?.qualityGate?.isolatedDefects)) {
    result.qualityGate.isolatedDefects.forEach(pushDefect);
  }
  for (const item of appliedList) {
    if (Array.isArray(item?.isolatedDefects)) {
      item.isolatedDefects.forEach(pushDefect);
    }
  }

  const hasIsolatedDefects = isolatedDefects.length > 0 || isolatedCount > 0;
  const isOverallSuccess = Boolean(result?.success === true && topStatus !== 'FAILED' && failedCount === 0);
  const isPartial =
    topStatus === 'PARTIAL' ||
    (passedCount > 0 && (failedCount > 0 || hasIsolatedDefects));

  const totalCount = batchCount || appliedList.length || (passedCount + failedCount + isolatedCount);

  if (isNoChanges && result?.success !== false && failedCount === 0) {
    return {
      passedCount,
      failedCount,
      isolatedCount,
      isOverallSuccess: true,
      isPartial: false,
      isNoChanges: true,
      hasIsolatedDefects,
      isolatedDefects,
      message: result?.message || 'No test changes were applied; the existing suite already satisfies coverage.',
      errorMessage: null,
    };
  }

  const isDraftOnly =
    !isNoChanges &&
    result?.success === true &&
    failedCount === 0 &&
    (topStatus === 'VERIFIED_DRAFT' || result?.fileUpdated === false);

  if (isDraftOnly) {
    const defectDetail = formatIsolatedDefectsDiagnostic(isolatedDefects);
    const draftMsg = defectDetail
      ? `Verified draft only; files were not written. ${defectDetail}`
      : (result?.message || 'Verified draft only; files were not written.');
    return {
      passedCount: 0,
      failedCount,
      isolatedCount,
      isOverallSuccess: false,
      isPartial: false,
      isNoChanges: false,
      isVerifiedDraft: true,
      hasIsolatedDefects,
      isolatedDefects,
      message: draftMsg,
      errorMessage: draftMsg,
    };
  }

  const topError =
    result?.errorDetail ||
    result?.testRunError ||
    result?.message ||
    (failedCount > 0 ? `${failedCount} test suggestion(s) failed verification.` : 'Batch verification failed. The active version is unchanged.');

  if (!isOverallSuccess && passedCount === 0) {
    const defectSuffix = hasIsolatedDefects ? ` ${formatIsolatedDefectsDiagnostic(isolatedDefects) || ''}` : '';
    const errMsg = `${topError}${defectSuffix}`.trim();
    return {
      passedCount,
      failedCount,
      isolatedCount,
      isOverallSuccess: false,
      isPartial: false,
      isNoChanges,
      hasIsolatedDefects,
      isolatedDefects,
      message: errMsg,
      errorMessage: errMsg,
    };
  }

  if (isPartial || failedCount > 0 || hasIsolatedDefects) {
    const summaryParts = [`Applied ${passedCount} of ${totalCount} test suggestion(s)`];
    if (failedCount > 0) summaryParts.push(`${failedCount} failed`);
    if (hasIsolatedDefects) summaryParts.push(`${isolatedCount || isolatedDefects.length} isolated`);
    const defectDetail = formatIsolatedDefectsDiagnostic(isolatedDefects);
    const partialMsg = defectDetail
      ? `${summaryParts.join(', ')}. ${defectDetail}`
      : `${summaryParts.join(', ')}.`;

    return {
      passedCount,
      failedCount,
      isolatedCount,
      isOverallSuccess,
      isPartial: true,
      isNoChanges,
      hasIsolatedDefects,
      isolatedDefects,
      message: partialMsg,
      errorMessage: (!isOverallSuccess || failedCount > 0) ? (result?.errorDetail || result?.message || partialMsg) : null,
    };
  }

  const successMsg = result?.coverageGoalStatus === 'MET'
    ? 'Applied the entire batch and met the 100% coverage goal.'
    : (result?.message || 'Applied the entire batch. Check the coverage report for remaining gaps.');

  return {
    passedCount,
    failedCount,
    isolatedCount,
    isOverallSuccess: true,
    isPartial: false,
    isNoChanges: false,
    hasIsolatedDefects: false,
    isolatedDefects: [],
    message: successMsg,
    errorMessage: null,
  };
}

export function evaluateUnitTestApplyResponse(res, suggestion = null) {
  const data = res && typeof res === 'object' && 'data' in res
    ? (res.data && typeof res.data === 'object' ? res.data : {})
    : (res && typeof res === 'object' ? res : {});

  const appliedList = Array.isArray(data.appliedSuggestions) ? data.appliedSuggestions : [];
  const sugId = suggestion?.suggestionId || suggestion?.id || null;
  const sugTestKey = normalizeReviewTestFile(suggestion?.testFile || suggestion?.targetTestFile || '').groupKey;

  let matchedItem = null;
  if (sugId) {
    matchedItem = appliedList.find((item) => (item?.suggestionId || item?.id) === sugId) || null;
  }
  if (!matchedItem && sugTestKey) {
    const testMatches = appliedList.filter(
      (item) => normalizeReviewTestFile(item?.testFile || item?.targetTestFile || '').groupKey === sugTestKey,
    );
    if (testMatches.length > 0) {
      matchedItem = pickBestTestFileMatch(
        testMatches,
        suggestion,
        (p) => normalizeReviewTestFile(p).groupKey,
      );
    }
  }
  if (!matchedItem && appliedList.length === 1) {
    const onlyItem = appliedList[0];
    const onlyId = onlyItem?.suggestionId || onlyItem?.id || null;
    const onlyTestKey = normalizeReviewTestFile(onlyItem?.testFile || onlyItem?.targetTestFile || '').groupKey;
    const idMismatch = Boolean(sugId && onlyId && sugId !== onlyId);
    const testFileMismatch = Boolean(sugTestKey && onlyTestKey && sugTestKey !== onlyTestKey);
    if (!idMismatch && !testFileMismatch) {
      matchedItem = onlyItem;
    }
  }

  const isolatedDefects = Array.isArray(matchedItem?.isolatedDefects) && matchedItem.isolatedDefects.length > 0
    ? matchedItem.isolatedDefects
    : (Array.isArray(data?.qualityGate?.isolatedDefects) ? data.qualityGate.isolatedDefects : []);

  const status = data.status || matchedItem?.status || null;
  const itemFailed = matchedItem?.status === 'FAILED';
  const itemIsolated = matchedItem?.status === 'ISOLATED';
  const topFailed =
    data.success === false ||
    status === 'FAILED' ||
    (data.success !== true && !['PASSED', 'APPLIED', 'PARTIAL', 'VERIFIED_DRAFT', 'NO_CHANGES'].includes(status));

  if (topFailed || itemFailed || itemIsolated) {
    const defectFallback = formatIsolatedDefectsDiagnostic(isolatedDefects);
    const error =
      matchedItem?.error ||
      data.errorDetail ||
      data.testRunError ||
      data.message ||
      defectFallback ||
      'Unable to apply test case to file.';

    return {
      ok: false,
      outcome: itemIsolated || (status === 'ISOLATED' && !itemFailed) ? 'ISOLATED' : 'FAILED',
      applied: false,
      error,
      isolatedDefects,
      data,
    };
  }

  if (status === 'NO_CHANGES') {
    return {
      ok: true,
      outcome: 'NO_CHANGES',
      applied: false,
      message: data.message || 'No test changes were applied; the existing suite already satisfies coverage.',
      warning: data.postApplyAnalysisError || null,
      isolatedDefects,
      data,
    };
  }

  const isPartial = status === 'PARTIAL' || isolatedDefects.length > 0;
  const isVerifiedDraft = status === 'VERIFIED_DRAFT' || data.fileUpdated === false;
  const isolationWarning = isolatedDefects.length > 0
    ? `Isolated target source defect(s): ${isolatedDefects.map((d) => d.symbol || d.diagnostic || 'unknown').join(', ')}. Valid tests were applied.`
    : null;

  return {
    ok: true,
    outcome: isPartial ? 'PARTIAL' : (isVerifiedDraft ? 'VERIFIED_DRAFT' : 'APPLIED'),
    applied: data.fileUpdated !== false && status !== 'VERIFIED_DRAFT',
    message: data.message || null,
    warning: isolationWarning || data.postApplyAnalysisError || null,
    isolatedDefects,
    data,
  };
}
