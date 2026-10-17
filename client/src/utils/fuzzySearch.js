/**
 * Normalizes text by removing Vietnamese accents, punctuation, and extra whitespace.
 */
export function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s/:.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculates Damerau-Levenshtein distance between two strings (allowing insertions, deletions, substitutions, and transpositions).
 */
export function levenshteinDistance(s1, s2) {
  const a = s1 || "";
  const b = s2 || "";
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );

      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }

  return dp[m][n];
}

/**
 * Checks whether a single token fuzzy matches a target text.
 */
export function fuzzyMatchToken(token, targetWords, fullTargetNorm) {
  if (!token) return true;
  const tNorm = normalizeText(token);
  if (!tNorm) return true;

  // 1. Direct substring in full combined string
  if (fullTargetNorm.includes(tNorm)) {
    return { match: true, score: 100 };
  }

  // 2. Check each target word
  let bestScore = 0;
  for (const word of targetWords) {
    if (!word) continue;

    // Exact word match
    if (word === tNorm) {
      return { match: true, score: 95 };
    }

    // Prefix match
    if (word.startsWith(tNorm)) {
      bestScore = Math.max(bestScore, 85);
      continue;
    }

    // Substring match
    if (word.includes(tNorm)) {
      bestScore = Math.max(bestScore, 80);
      continue;
    }

    // Acronym / Subsequence match (e.g. "fditm" in "food-items", "chk" in "checkout")
    if (tNorm.length >= 3 && isSubsequence(tNorm, word)) {
      bestScore = Math.max(bestScore, 75);
      continue;
    }

    // Typo tolerance based on length:
    // - Length 3: allow 1 edit if length matches exactly
    // - Length 4-6: allow 1 edit
    // - Length >= 7: allow 2 edits
    if (tNorm.length >= 3 && Math.abs(word.length - tNorm.length) <= 2) {
      const dist = levenshteinDistance(tNorm, word);
      if (tNorm.length === 3 && dist <= 1 && word.length === 3) {
        bestScore = Math.max(bestScore, 70);
      } else if (tNorm.length >= 4 && tNorm.length <= 6 && dist <= 1) {
        bestScore = Math.max(bestScore, 70 - dist * 10);
      } else if (tNorm.length >= 7 && dist <= 2) {
        bestScore = Math.max(bestScore, 65 - dist * 10);
      }
    }
  }

  return { match: bestScore > 0, score: bestScore };
}

/**
 * Helper to check if s1 is a subsequence of s2
 */
function isSubsequence(s1, s2) {
  let i = 0;
  let j = 0;
  while (i < s1.length && j < s2.length) {
    if (s1[i] === s2[j]) {
      i++;
    }
    j++;
  }
  return i === s1.length;
}

/**
 * Evaluates whether a scenario matches a multi-token fuzzy query.
 *
 * @param {object} scenario - Scenario object
 * @param {object} epData - Endpoint data ({ method, path, module })
 * @param {string} query - Raw search query from user
 * @returns {{ match: boolean, score: number }}
 */
export function matchScenarioFuzzy(scenario, epData, query) {
  if (!query || !query.trim()) {
    return { match: true, score: 0 };
  }

  const cleanQuery = normalizeText(query);
  const tokens = cleanQuery.split(" ").filter(Boolean);
  if (tokens.length === 0) return { match: true, score: 0 };

  const testName = scenario.testName || scenario.title || "";
  const method = epData?.method || scenario.method || "";
  const path = epData?.path || scenario.path || "";
  const mod = epData?.module || "";
  const expectedStatus = scenario.expectedStatus ? String(scenario.expectedStatus) : "";
  const label = scenario.classificationLabel || "";
  const desc = scenario.description || "";

  // Combine all searchable text
  const fullText = `${method} ${path} ${mod} ${testName} ${expectedStatus} ${label} ${desc}`;
  const fullTargetNorm = normalizeText(fullText);

  // Break into individual words for token-level typo tolerance
  const words = fullTargetNorm
    .split(/[\s/:._-]+/)
    .filter((w) => w.length > 0);

  let totalScore = 0;

  for (const token of tokens) {
    // Check if token matches HTTP status number
    if (/^\d{3}$/.test(token)) {
      const hasStatusInName = new RegExp(`\\b${token}\\b`).test(testName);
      const hasExpected = expectedStatus === token;
      if (hasStatusInName || hasExpected) {
        totalScore += 100;
        continue;
      }
    }

    const res = fuzzyMatchToken(token, words, fullTargetNorm);
    if (!res.match) {
      return { match: false, score: 0 };
    }
    totalScore += res.score;
  }

  const averageScore = Math.round(totalScore / tokens.length);
  return { match: true, score: averageScore };
}
