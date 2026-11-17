import { needsUnitTestSuggestion } from '../../../shared/unitTestCoverageGoal.js';
export { needsUnitTestSuggestion };

/**
 * Loads source files for unit test suggestions.
 * Fetches page 1 to inspect totalPages, then fetches any remaining pages in parallel batches
 * to eliminate the sequential pagination waterfall.
 *
 * @param {Function} loadPage - Async function (pageNumber) => Promise<Response>
 * @param {Array} [initialFiles=[]] - Optional initial files to seed the map
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.maxPages=10] - Safety cap on total pages to prevent runaway requests
 * @param {number} [options.concurrency=4] - Concurrency limit for parallel page requests
 * @param {boolean} [options.parallel=true] - Whether to fetch subsequent pages in parallel
 * @returns {Promise<Array>} Deduplicated array of source file coverage objects
 */
export async function loadSuggestionSourceFiles(
  loadPage,
  initialFiles = [],
  { maxPages = 10, concurrency = 4, parallel = true } = {}
) {
  const files = new Map();

  // Seed with initial files (if any), preserving valid file objects
  for (const file of initialFiles || []) {
    if (file?.filePath) {
      files.set(file.filePath, file);
    }
  }

  // 1. Fetch Page 1 to get initial data and totalPages metadata
  let firstResponse;
  try {
    firstResponse = await loadPage(1);
  } catch (err) {
    console.warn("[loadSuggestionSourceFiles] Failed to load page 1:", err);
    // If initial files exist, return what we have; otherwise rethrow
    if (files.size > 0) return [...files.values()];
    throw err;
  }

  const firstData = firstResponse?.data || firstResponse;
  for (const file of firstData?.files || []) {
    if (file?.filePath) files.set(file.filePath, file);
  }

  const totalPages = Math.max(1, firstData?.pagination?.totalPages || 1);
  const effectiveMaxPage = Math.min(totalPages, Math.max(1, maxPages));

  // If only 1 page exists or we've reached maxPages, return immediately
  if (effectiveMaxPage <= 1) {
    return [...files.values()];
  }

  // 2. Fetch remaining pages (pages 2 through effectiveMaxPage)
  const remainingPages = [];
  for (let p = 2; p <= effectiveMaxPage; p += 1) {
    remainingPages.push(p);
  }

  if (parallel) {
    // Fetch remaining pages in bounded parallel batches to avoid socket exhaustion
    for (let i = 0; i < remainingPages.length; i += concurrency) {
      const pageBatch = remainingPages.slice(i, i + concurrency);
      const batchResponses = await Promise.all(
        pageBatch.map((p) =>
          Promise.resolve()
            .then(() => loadPage(p))
            .catch((err) => {
              console.warn(`[loadSuggestionSourceFiles] Failed to load page ${p}:`, err);
              return null;
            })
        )
      );

      for (const res of batchResponses) {
        if (!res) continue;
        const pageData = res?.data || res;
        for (const file of pageData?.files || []) {
          if (file?.filePath) files.set(file.filePath, file);
        }
      }
    }
  } else {
    // Sequential fallback if parallel is explicitly set to false
    for (const p of remainingPages) {
      try {
        const res = await loadPage(p);
        const pageData = res?.data || res;
        for (const file of pageData?.files || []) {
          if (file?.filePath) files.set(file.filePath, file);
        }
      } catch (err) {
        console.warn(`[loadSuggestionSourceFiles] Failed to load page ${p}:`, err);
      }
    }
  }

  return [...files.values()];
}
