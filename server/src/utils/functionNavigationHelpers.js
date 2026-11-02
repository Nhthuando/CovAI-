/**
 * Function Navigation Helpers & Contract Specifications
 * Implements Section 3 of docs/function-coverage-cfg-code-navigation-plan.md
 */

/**
 * Normalizes POSIX paths for safe cross-platform comparison
 * @param {string} p - Input path
 * @returns {string} - Normalized lowercase path
 */
export const normalizePathForCompare = (p) => {
  if (!p || typeof p !== "string") return "";
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^(?:.*?\/)?storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i, "")
    .replace(/^(?:.*?\/)?repo\//i, "")
    .toLowerCase();
};

/**
 * Matches target file within candidate CFG files
 * @param {string[]} candidateFiles - Candidate file paths
 * @param {string} targetPath - Target path to match
 * @returns {string|null} - Best matched file or fallback
 */
export const findMatchingCfgFile = (candidateFiles, targetPath) => {
  if (!targetPath || !Array.isArray(candidateFiles) || candidateFiles.length === 0) {
    return candidateFiles?.[0] || null;
  }
  const targetNorm = normalizePathForCompare(targetPath);

  // 1. Exact full match
  const exact = candidateFiles.find((f) => normalizePathForCompare(f) === targetNorm);
  if (exact) return exact;

  // 2. Suffix match (endsWith)
  const endsWithMatch = candidateFiles.find(
    (f) =>
      targetNorm.endsWith("/" + normalizePathForCompare(f)) ||
      normalizePathForCompare(f).endsWith("/" + targetNorm)
  );
  if (endsWithMatch) return endsWithMatch;

  // 3. Match after stripping monorepo root prefixes
  const strippedTarget = targetNorm.replace(/^(?:backend|server|client|api|app|frontend)\//i, "");
  const strippedMatch = candidateFiles.find((f) => {
    const strippedCandidate = normalizePathForCompare(f).replace(/^(?:backend|server|client|api|app|frontend)\//i, "");
    return (
      strippedCandidate === strippedTarget ||
      strippedTarget.endsWith("/" + strippedCandidate) ||
      strippedCandidate.endsWith("/" + strippedTarget)
    );
  });
  if (strippedMatch) return strippedMatch;

  // 4. Basename match
  const baseTarget = targetNorm.split("/").pop();
  const baseMatch = candidateFiles.find(
    (f) => normalizePathForCompare(f).split("/").pop() === baseTarget
  );
  if (baseMatch) return baseMatch;

  // 5. Prefix match (handles truncated paths with ... in UI)
  const cleanPrefix = targetNorm.replace(/\.{2,}$/, "");
  if (cleanPrefix.length > 5) {
    const prefixMatch = candidateFiles.find((f) =>
      normalizePathForCompare(f).startsWith(cleanPrefix)
    );
    if (prefixMatch) return prefixMatch;
  }

  return candidateFiles[0];
};

/**
 * Matches target function in file CFG list using a 5-tier resolution strategy:
 * 1. Exact function name match (or truncated prefix)
 * 2. Exact startLine match
 * 3. Innermost Span match
 * 4. Synthetic func_L{N} match
 * 5. Fallback to first function
 * @param {Array<{functionName: string, startLine?: number, endLine?: number}>} fileCfgs
 * @param {string} targetFuncName
 * @param {number} targetLine
 * @returns {string|null} - Matched function name
 */
export const findMatchingCfgFunction = (fileCfgs, targetFuncName, targetLine) => {
  if (!Array.isArray(fileCfgs) || fileCfgs.length === 0) return null;
  const lineNum = targetLine && Number(targetLine) > 0 ? Number(targetLine) : null;

  // 1. Function name match (if not anonymous or synthetic func_L...)
  if (targetFuncName && typeof targetFuncName === "string") {
    const cleanTarget = targetFuncName.replace(/\(\)$/, "").trim();
    const isSyntheticOrAnon =
      /^func_l\d+$/i.test(cleanTarget) ||
      /^anonymous/i.test(cleanTarget) ||
      /^\(anonymous/i.test(cleanTarget);

    if (!isSyntheticOrAnon && cleanTarget.length > 0) {
      // 1a. Exact name match
      const exactMatch = fileCfgs.find((c) => c.functionName === cleanTarget);
      if (exactMatch) return exactMatch.functionName;

      // 1b. Case-insensitive match
      const caseMatch = fileCfgs.find(
        (c) => c.functionName?.toLowerCase() === cleanTarget.toLowerCase()
      );
      if (caseMatch) return caseMatch.functionName;

      // 1c. Prefix match (handles truncated names like fallbackRewriteFr...)
      const prefix = cleanTarget.replace(/\.{2,}$/, "").trim();
      if (prefix.length >= 6) {
        const prefixMatch = fileCfgs.find(
          (c) =>
            c.functionName &&
            (c.functionName.startsWith(prefix) ||
             c.functionName.toLowerCase().startsWith(prefix.toLowerCase()))
        );
        if (prefixMatch) return prefixMatch.functionName;
      }
    }
  }

  // 2. Exact startLine match (avoids enclosing outer functions when target is callback)
  if (lineNum !== null) {
    const exactStartMatch = fileCfgs.find((c) => c.startLine === lineNum);
    if (exactStartMatch) return exactStartMatch.functionName;
  }

  // 3. Innermost Span match
  if (lineNum !== null) {
    const containingFunctions = fileCfgs.filter(
      (c) => c.startLine <= lineNum && c.endLine && c.endLine >= lineNum
    );
    if (containingFunctions.length > 0) {
      containingFunctions.sort(
        (a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine)
      );
      return containingFunctions[0].functionName;
    }
  }

  // 4. Synthetic func_L{N} match
  if (targetFuncName && typeof targetFuncName === "string") {
    const match = targetFuncName.trim().match(/^func_l(\d+)$/i);
    if (match) {
      const parsedLine = Number(match[1]);
      const lineExact = fileCfgs.find((c) => c.startLine === parsedLine);
      if (lineExact) return lineExact.functionName;
    }
  }

  // 5. Fallback: return first function
  return fileCfgs[0].functionName;
};

/**
 * Creates and validates FunctionNavigationTarget contract
 */
export const createFunctionNavigationTarget = ({
  filePath,
  functionName,
  displayName,
  startLine,
  endLine,
  hit = 0,
}) => {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("filePath is required and must be a string");
  }
  if (!functionName || typeof functionName !== "string") {
    throw new Error("functionName is required and must be a string");
  }
  const safeStartLine = Math.max(1, Number(startLine) || 1);
  const safeEndLine = endLine ? Math.max(safeStartLine, Number(endLine)) : safeStartLine;

  return {
    filePath: filePath.replace(/\\/g, "/").replace(/^\.\//, ""),
    functionName: functionName.trim(),
    displayName: displayName ? displayName.trim() : `${functionName}()`,
    startLine: safeStartLine,
    endLine: safeEndLine,
    hit: Math.max(0, Number(hit) || 0),
  };
};

/**
 * Creates CfgInitialContext contract
 */
export const createCfgInitialContext = (filePath, functionName = null, initialLine = null) => {
  if (!filePath) return null;
  return {
    initialFile: filePath.replace(/\\/g, "/").replace(/^\.\//, ""),
    initialFunc: functionName ? String(functionName).trim() : null,
    initialLine: initialLine && Number(initialLine) > 0 ? Number(initialLine) : null,
    timestamp: Date.now(),
  };
};

/**
 * Creates EditorJumpTarget contract
 */
export const createEditorJumpTarget = (filePath, line, endLine = null, functionName = null) => {
  if (!filePath) return null;
  const safeLine = Math.max(1, Number(line) || 1);
  const safeEndLine = endLine ? Math.max(safeLine, Number(endLine)) : safeLine;

  return {
    filePath: filePath.replace(/\\/g, "/").replace(/^\.\//, ""),
    line: safeLine,
    endLine: safeEndLine,
    functionName: functionName ? String(functionName).trim() : null,
    timestamp: Date.now(),
  };
};

/**
 * Calculates safe line clamp based on Monaco Editor model
 */
export const calculateClampedLineRange = (line, endLine, maxLines = 1) => {
  const safeMax = Math.max(1, Number(maxLines) || 1);
  const safeLine = Math.min(Math.max(1, Number(line) || 1), safeMax);
  const safeEndLine = Math.min(Math.max(safeLine, Number(endLine) || safeLine), safeMax);
  return {
    startLine: safeLine,
    startColumn: 1,
    endLine: safeEndLine,
    endColumn: 1,
  };
};

export const calculateSafeMonacoLineRange = calculateClampedLineRange;

