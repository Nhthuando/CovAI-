/**
 * Dynamic test file resolution for Jest and Vitest suites.
 * Matches existing test suites from coverage data or calculates conventional fallbacks.
 */

/**
 * Normalizes a repository or storage path to a clean relative path.
 * Compatible with cleanDisplayPath from CoverageTypeDashboard.
 */
export function cleanDisplayPath(fullPath = "") {
  if (!fullPath || typeof fullPath !== "string") return "";
  let normalized = fullPath.replace(/\\/g, "/").trim();

  // Strip Windows drive letter early (e.g. C:/ or C:)
  normalized = normalized.replace(/^[a-zA-Z]:\/?/, "");

  // Sanitize path traversal attempts (e.g. ../ or /../)
  normalized = normalized.replace(/(?:^|\/)\.\.(?:\/|$)/g, "/");
  normalized = normalized.replace(/\.\.(?:\/|$)/g, "");

  // Strip leading dots and slashes
  normalized = normalized.replace(/^[\.\/]+/, "");

  // Match inside docker or repo storage: storage/projects/<id>/.../repo/<relativePath>
  const repoMatch = normalized.match(/(?:^|\/)repo\/(.+)$/i);
  if (repoMatch) return repoMatch[1].replace(/^\/+/, "");

  if (/(?:^|\/)(?:repo|storage\/projects\/[^/]+(?:\/[^/]+)*)\/?$/i.test(normalized)) {
    return "";
  }

  const storageMatch = normalized.match(/(?:^|\/)storage\/projects\/[^/]+(?:\/[^/]+)*?\/(.+)$/i);
  if (storageMatch) return storageMatch[1].replace(/^\/+/, "");

  const uploadProjMatch = normalized.match(/(?:^|\/)uploads\/snapshots\/[^/]+\/[^/]+\/(.+)$/i);
  if (uploadProjMatch) return uploadProjMatch[1].replace(/^\/+/, "");

  const uploadMatch = normalized.match(/(?:^|\/)uploads\/snapshots\/[^/]+\/(.+)$/i);
  if (uploadMatch) return uploadMatch[1].replace(/^\/+/, "");

  // Docker /app/ prefix
  normalized = normalized.replace(/^\/?app\/(?:storage|uploads|projects)?\/?/i, "");

  // Strip leading project name prefix if it wraps standard package directories (e.g. "Online-Food-Ordering-System/server/...")
  // Do NOT strip if the first segment is already a valid package root (server, client, packages, apps)
  const projPrefixMatch = normalized.match(/^(?!(?:server|client|packages|apps)\/)[^/]+(?:\/)(server|client|src|tests?|__tests__|packages|apps|lib|dist)\/(.+)$/i);
  if (projPrefixMatch) {
    return `${projPrefixMatch[1]}/${projPrefixMatch[2]}`;
  }

  return normalized.replace(/^\/+/, "");
}

/**
 * Resolves the appropriate test file path for a source file.
 * 
 * Strategy:
 * 1. Explicit override check: Returns explicitTestFile if provided.
 * 2. Already a test file: Returns clean source if already classified as a test.
 * 3. Heuristic matching against unitTestSuites:
 *    - Base stem match (+120)
 *    - Service/Controller module stem match (+90)
 *    - Partial/affix match (+60 / +40)
 *    - Subproject alignment (server/ vs client/) (+40 / -200)
 *    - Directory proximity (__tests__, co-located, mirrored dirs) (+70 / +25 per dir)
 *    - Framework compatibility (+25 / -40)
 * 4. Conventional fallback if score < 75:
 *    - Adapts to prevalent project conventions (tests/ vs test/ vs src/__tests__/)
 *    - Preserves subproject prefixes (server/tests/... vs client/tests/...)
 *    - Respects file extension (.ts vs .js)
 * 
 * Supports both call styles:
 * - resolveTargetTestFile(sourceFilePath, unitTestSuites, options)
 * - resolveTargetTestFile({ sourceFile, unitTestSuites, preferredFramework, explicitTestFile })
 */
export function resolveTargetTestFile(sourceFilePath, unitTestSuites = [], options = {}) {
  let sourceFile;
  let suites = unitTestSuites;
  let preferredFramework = null;
  let explicitTestFile = null;

  if (typeof sourceFilePath === 'object' && sourceFilePath !== null && !Array.isArray(sourceFilePath)) {
    sourceFile = sourceFilePath.sourceFile || sourceFilePath.filePath || sourceFilePath.sourceFilePath;
    suites = sourceFilePath.unitTestSuites || unitTestSuites || [];
    preferredFramework = sourceFilePath.preferredFramework || sourceFilePath.framework || null;
    explicitTestFile = sourceFilePath.explicitTestFile || sourceFilePath.targetTestFile || null;
  } else {
    sourceFile = sourceFilePath;
    if (typeof options === 'object' && options !== null) {
      preferredFramework = options.preferredFramework || options.framework || null;
      explicitTestFile = options.explicitTestFile || options.targetTestFile || null;
    }
  }

  if (explicitTestFile && typeof explicitTestFile === 'string' && explicitTestFile.trim()) {
    return cleanDisplayPath(explicitTestFile);
  }

  const cleanSrc = cleanDisplayPath(sourceFile);
  if (!cleanSrc) return 'tests/sample.test.js';

  // If source file is already a test file, target itself
  if (/\.(test|spec)\.[a-z0-9]+$/i.test(cleanSrc) || /(?:^|\/)__tests__\//i.test(cleanSrc)) {
    return cleanSrc;
  }

  // Deconstruct source file
  const extMatch = cleanSrc.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '.js';
  const targetExt = (ext === '.ts' || ext === '.tsx') ? '.ts' : '.js';
  const fileName = cleanSrc.split('/').pop();
  const rawBase = fileName.replace(/\.[^.]+$/, '');
  
  // Stem name (strip .service, .controller, .routes, etc.)
  const stemName = rawBase.replace(/\.(service|controller|routes?|model|repository|util|helper|handler|middleware|validator|dao)$/i, '');
  const dirName = cleanSrc.split('/').slice(0, -1).join('/');
  const subprojectPrefixMatch = cleanSrc.match(/^(.*?(?:^|\/)(server|client))\/(.*)$/i);
  const subproject = subprojectPrefixMatch ? subprojectPrefixMatch[2].toLowerCase() : null;
  const subprojectPrefix = subprojectPrefixMatch ? subprojectPrefixMatch[1] : null;

  // Extract meaningful directory tokens (ignoring standard structural names)
  const dirTokens = dirName
    .toLowerCase()
    .split('/')
    .filter(token => !['src', 'server', 'client', 'app', 'packages', 'services', 'lib', '.'].includes(token));

  let bestCandidate = null;
  let bestScore = -Infinity;

  const safeSuites = Array.isArray(suites) ? suites : [];

  for (const suite of safeSuites) {
    if (!suite || typeof suite !== 'object') continue;
    const rawSuitePath = typeof suite.filePath === 'string' ? suite.filePath : (typeof suite.fileName === 'string' ? suite.fileName : '');
    if (!rawSuitePath) continue;

    const cleanSuite = cleanDisplayPath(rawSuitePath);
    const suiteFileName = typeof suite.fileName === 'string' && suite.fileName ? suite.fileName : cleanSuite.split('/').pop();
    const suiteBase = suiteFileName.replace(/\.(test|spec)\.[a-z0-9]+$/i, '').replace(/\.[^.]+$/, '');
    const suiteSubprojectMatch = cleanSuite.match(/(?:^|\/)(server|client)(?:\/|$)/i);
    const suiteSubproject = suiteSubprojectMatch ? suiteSubprojectMatch[1].toLowerCase() : null;

    let score = 0;

    // Subproject boundary guard: Never map server code to client tests or vice-versa
    if (subproject && suiteSubproject && subproject !== suiteSubproject) {
      continue;
    }
    if (subproject && suiteSubproject && subproject === suiteSubproject) {
      score += 40;
    }

    // Exact stem match
    if (suiteBase.toLowerCase() === rawBase.toLowerCase()) {
      score += 120;
    } else if (stemName && suiteBase.toLowerCase() === stemName.toLowerCase()) {
      score += 90;
    } else if (suiteBase.toLowerCase().startsWith(rawBase.toLowerCase()) || suiteBase.toLowerCase().endsWith(rawBase.toLowerCase())) {
      score += 60;
    } else if (stemName && (suiteBase.toLowerCase().startsWith(stemName.toLowerCase()) || suiteBase.toLowerCase().endsWith(stemName.toLowerCase()))) {
      score += 50;
    } else if (suiteBase.toLowerCase().includes(rawBase.toLowerCase())) {
      score += 35;
    }

    // Directory proximity
    if (dirName && (cleanSuite.includes(`${dirName}/__tests__/`) || cleanSuite.startsWith(`${dirName}/`))) {
      score += 70;
    } else {
      // Shared directory tokens
      const cleanSuiteLower = cleanSuite.toLowerCase();
      for (const token of dirTokens) {
        if (cleanSuiteLower.includes(`/${token}/`) || cleanSuiteLower.includes(`/${token}.`)) {
          score += 25;
        }
      }
    }

    // Framework affinity
    if (preferredFramework) {
      const suiteFramework = (suite.framework || '').toLowerCase();
      if (suiteFramework === preferredFramework.toLowerCase()) {
        score += 25;
      }
      if (preferredFramework.toLowerCase() === 'vitest' && cleanSuite.toLowerCase().includes('vitest')) {
        score += 25;
      } else if (preferredFramework.toLowerCase() === 'jest' && cleanSuite.toLowerCase().includes('vitest')) {
        score -= 40;
      }
    }

    // Generic name penalty (e.g. index.test.js, app.test.js) without direct folder match
    if (['index', 'app', 'main', 'api', 'server', 'all'].includes(suiteBase.toLowerCase())) {
      score -= 80;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cleanSuite;
    }
  }

  // If a high-confidence existing test suite is found, return it
  if (bestCandidate && bestScore >= 75) {
    return bestCandidate;
  }

  // Conventional fallback calculation
  const hasSrcTests = safeSuites.some(s => {
    if (!s || typeof s !== 'object') return false;
    const raw = typeof s.filePath === 'string' ? s.filePath : (typeof s.fileName === 'string' ? s.fileName : '');
    const p = cleanDisplayPath(raw);
    return p.includes('/src/__tests__/') || p.startsWith('src/__tests__/');
  });
  const hasTestDir = safeSuites.some(s => {
    if (!s || typeof s !== 'object') return false;
    const raw = typeof s.filePath === 'string' ? s.filePath : (typeof s.fileName === 'string' ? s.fileName : '');
    const p = cleanDisplayPath(raw);
    return /(?:^|\/)test\//i.test(p);
  });
  const hasSpecExt = safeSuites.some(s => {
    if (!s || typeof s !== 'object') return false;
    const raw = typeof s.filePath === 'string' ? s.filePath : (typeof s.fileName === 'string' ? s.fileName : '');
    return /\.spec\.[a-z0-9]+$/i.test(cleanDisplayPath(raw));
  });
  const testKeyword = hasSpecExt ? 'spec' : 'test';

  if (subprojectPrefixMatch) {
    const innerPath = subprojectPrefixMatch[3];
    const rawInnerRel = innerPath.replace(/^src\//, '').replace(/\.[^.]+$/, '');
    const safeInnerRel = rawInnerRel.replace(/\.\.(?:\/|$)/g, '').replace(/^\/+/, '');
    if (hasSrcTests) {
      return `${subprojectPrefix}/src/__tests__/${safeInnerRel}.${testKeyword}${targetExt}`;
    }
    if (hasTestDir) {
      return `${subprojectPrefix}/test/${safeInnerRel}.${testKeyword}${targetExt}`;
    }
    return `${subprojectPrefix}/tests/${safeInnerRel}.${testKeyword}${targetExt}`;
  }

  const rawInnerRel = cleanSrc.replace(/^src\//, '').replace(/\.[^.]+$/, '');
  const safeInnerRel = rawInnerRel.replace(/\.\.(?:\/|$)/g, '').replace(/^\/+/, '');
  if (hasSrcTests) {
    return `src/__tests__/${safeInnerRel}.${testKeyword}${targetExt}`;
  }
  if (hasTestDir) {
    return `test/${safeInnerRel}.${testKeyword}${targetExt}`;
  }
  return `tests/${safeInnerRel}.${testKeyword}${targetExt}`;
}

/**
 * Computes a sensible relative import path from tests/ to the source file.
 * Handles Docker /app/ prefixes, repo directories, and nested directories cleanly.
 */
export function computeRelativeImport(filePath = "", targetTestPath = "") {
  if (!filePath) return "../src/services/sample";
  const cleanSrc = cleanDisplayPath(filePath).replace(/\.[cm]?[jt]sx?$/, "");
  if (!targetTestPath) {
    if (cleanSrc.startsWith("src/")) return `../${cleanSrc}`;
    return `../../${cleanSrc}`;
  }
  const cleanTest = cleanDisplayPath(targetTestPath);
  const testParts = cleanTest.split("/").slice(0, -1);
  const srcParts = cleanSrc.split("/");

  let common = 0;
  while (common < testParts.length && common < srcParts.length && testParts[common] === srcParts[common]) {
    common++;
  }

  const upCount = testParts.length - common;
  const upStr = upCount > 0 ? "../".repeat(upCount) : "./";
  const downStr = srcParts.slice(common).join("/");
  return `${upStr}${downStr}` || "./";
}

/**
 * Fast bracket balance and syntax sanity check on generated unit test code.
 * Tolerates comments, strings, template literals, and RegExp literals.
 */
export function checkSyntaxSanity(code) {
  if (!code || typeof code !== "string") return { valid: true, error: null };
  const stack = [];
  const lines = code.split("\n");

  let inBlockComment = false;
  let inString = null; // '"', "'", or '`'

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    let c = 0;

    // Reset single/double quote strings across line boundaries
    if (inString === "'" || inString === '"') {
      inString = null;
    }

    let inRegex = false;

    while (c < line.length) {
      const char = line[c];
      const nextChar = line[c + 1];

      // Handle block comment ending
      if (inBlockComment) {
        if (char === "*" && nextChar === "/") {
          inBlockComment = false;
          c += 2;
          continue;
        }
        c++;
        continue;
      }

      // Handle string literal exit & escaping
      if (inString) {
        if (char === "\\") {
          c += 2;
          continue;
        }
        if (char === inString) {
          inString = null;
        }
        c++;
        continue;
      }

      // Handle regex literal exit & escaping
      if (inRegex) {
        if (char === "\\") {
          c += 2;
          continue;
        }
        if (char === "/") {
          inRegex = false;
        }
        c++;
        continue;
      }

      // Check start of line comments
      if (char === "/" && nextChar === "/") {
        break; // skip rest of line
      }

      // Check start of block comments
      if (char === "/" && nextChar === "*") {
        inBlockComment = true;
        c += 2;
        continue;
      }

      // Check start of regex literal: '/' preceded by operator/punctuation/start-of-statement
      if (char === "/") {
        const before = line.slice(0, c).trim();
        const lastChar = before.slice(-1);
        const isRegexStart =
          before.length === 0 ||
          "(=:[{,;!&|?+*~^%<>-".includes(lastChar) ||
          /\b(return|case|typeof|yield|await)$/.test(before);
        if (isRegexStart) {
          inRegex = true;
          c++;
          continue;
        }
      }

      // Check start of string literals
      if (char === "'" || char === '"' || char === "`") {
        inString = char;
        c++;
        continue;
      }

      // Escaped characters in code (e.g. \(, \{, \[, etc.)
      if (char === "\\") {
        c += 2;
        continue;
      }

      // Bracket balancing on actual code syntax
      if (char === "{" || char === "(" || char === "[") {
        stack.push({ char, line: l + 1, col: c + 1 });
      } else if (char === "}" || char === ")" || char === "]") {
        if (stack.length === 0) {
          return {
            valid: false,
            error: `Unexpected closing '${char}' at line ${l + 1}, column ${c + 1}.`,
          };
        }
        const top = stack.pop();
        const expected = top.char === "{" ? "}" : top.char === "(" ? ")" : "]";
        if (char !== expected) {
          return {
            valid: false,
            error: `Mismatched bracket: Opened '${top.char}' at line ${top.line} but found '${char}' at line ${l + 1}.`,
          };
        }
      }

      c++;
    }
  }

  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return {
      valid: false,
      error: `Unclosed bracket '${top.char}' opened at line ${top.line}, column ${top.col}. Please add corresponding closing bracket.`,
    };
  }

  return { valid: true, error: null };
}
