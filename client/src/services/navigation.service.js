/**
 * Navigation Service & Data Model Contracts
 * Implements Section 3 of docs/function-coverage-cfg-code-navigation-plan.md
 */

/**
 * Chuẩn hóa đường dẫn POSIX để so sánh an toàn độc lập hệ điều hành
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
 * Khớp file mục tiêu trong danh sách file CFG ứng viên
 */
export const findMatchingCfgFile = (candidateFiles, targetPath) => {
  if (!targetPath || !Array.isArray(candidateFiles) || candidateFiles.length === 0) {
    return candidateFiles?.[0] || null;
  }
  const targetNorm = normalizePathForCompare(targetPath);

  // 1. Khớp chính xác hoàn toàn
  const exact = candidateFiles.find((f) => normalizePathForCompare(f) === targetNorm);
  if (exact) return exact;

  // 2. Khớp đuôi (endsWith)
  const endsWithMatch = candidateFiles.find(
    (f) =>
      targetNorm.endsWith("/" + normalizePathForCompare(f)) ||
      normalizePathForCompare(f).endsWith("/" + targetNorm)
  );
  if (endsWithMatch) return endsWithMatch;

  // 3. Khớp sau khi loại bỏ prefix thư mục gốc monorepo (backend/, server/, client/, api/, app/)
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

  // 4. Khớp basename
  const baseTarget = targetNorm.split("/").pop();
  const baseMatch = candidateFiles.find(
    (f) => normalizePathForCompare(f).split("/").pop() === baseTarget
  );
  if (baseMatch) return baseMatch;

  // 5. Khớp tiền tố (hỗ trợ đường dẫn bị cắt ngắn dấu ... trên UI)
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
 * Khớp hàm mục tiêu trong danh sách CFGs của file với chiến lược phân giải 5 tầng:
 * 1. Khớp chính xác tên hàm (hoặc tiền tố cắt ngắn)
 * 2. Khớp chính xác startLine
 * 3. Khớp phạm vi lồng nhau hẹp nhất (Innermost Span)
 * 4. Khớp tên synthetic func_L{N}
 * 5. Fallback về hàm đầu tiên
 */
export const findMatchingCfgFunction = (fileCfgs, targetFuncName, targetLine) => {
  if (!Array.isArray(fileCfgs) || fileCfgs.length === 0) return null;
  const lineNum = targetLine && Number(targetLine) > 0 ? Number(targetLine) : null;

  // 1. Khớp tên hàm (nếu không phải anonymous hoặc synthetic func_L...)
  if (targetFuncName && typeof targetFuncName === "string") {
    const cleanTarget = targetFuncName.replace(/\(\)$/, "").trim();
    const isSyntheticOrAnon =
      /^func_l\d+$/i.test(cleanTarget) ||
      /^anonymous/i.test(cleanTarget) ||
      /^\(anonymous/i.test(cleanTarget);

    if (!isSyntheticOrAnon && cleanTarget.length > 0) {
      // 1a. Khớp chính xác tên
      const exactMatch = fileCfgs.find((c) => c.functionName === cleanTarget);
      if (exactMatch) return exactMatch.functionName;

      // 1b. Khớp không phân biệt hoa thường
      const caseMatch = fileCfgs.find(
        (c) => c.functionName?.toLowerCase() === cleanTarget.toLowerCase()
      );
      if (caseMatch) return caseMatch.functionName;

      // 1c. Khớp tiền tố (hỗ trợ tên bị cắt ngắn fallbackRewriteFr...)
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

  // 2. Khớp chính xác startLine (tránh bị hàm bao ngoài nuốt khi là callback)
  if (lineNum !== null) {
    const exactStartMatch = fileCfgs.find((c) => c.startLine === lineNum);
    if (exactStartMatch) return exactStartMatch.functionName;
  }

  // 3. Khớp theo khoảng bao hẹp nhất (Innermost Span)
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

  // 4. Khớp synthetic func_L{N}
  if (targetFuncName && typeof targetFuncName === "string") {
    const match = targetFuncName.trim().match(/^func_l(\d+)$/i);
    if (match) {
      const parsedLine = Number(match[1]);
      const lineExact = fileCfgs.find((c) => c.startLine === parsedLine);
      if (lineExact) return lineExact.functionName;
    }
  }

  // 5. Fallback: trả về hàm đầu tiên
  return fileCfgs[0].functionName;
};

/**
 * Tạo hợp đồng CfgInitialContext
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
 * Tạo hợp đồng EditorJumpTarget
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
 * Resolves the 1-indexed line number of a test scenario or function in file content.
 * 
 * Accurately finds:
 * - Jest/Vitest/Mocha test blocks: `it('...')`, `test("...")`, `describe(...)`
 * - Exact string matching for test scenario titles
 * - Ancestor title prefixes (e.g. "Suite > SubSuite > test")
 * - Function declarations, arrow functions, class methods
 * - Clean fallback without throwing
 *
 * @param {string} content - Raw file text content
 * @param {string} targetName - Test title or function name to locate
 * @param {boolean} isTestFile - Whether target file is a test suite
 * @returns {number|null} 1-indexed line number or null
 */
export const resolveTestOrFunctionLine = (content, targetName, isTestFile = false) => {
  if (!content || typeof content !== "string" || !targetName) return null;
  const lines = content.split(/\r?\n/);
  const cleanTarget = String(targetName).trim();
  if (!cleanTarget) return null;

  // 1. Direct exact quote match: "targetName" or 'targetName' or `targetName`
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes(`"${cleanTarget}"`) ||
      line.includes(`'${cleanTarget}'`) ||
      line.includes(`\`${cleanTarget}\``)
    ) {
      return i + 1;
    }
  }

  // 2. Strip status indicators or hits prefix e.g. "✓ ", "✗ ", "⚠️ "
  const strippedTarget = cleanTarget.replace(/^[✓✗⚠️]\s*/, "").trim();
  if (strippedTarget && strippedTarget !== cleanTarget) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        line.includes(`"${strippedTarget}"`) ||
        line.includes(`'${strippedTarget}'`) ||
        line.includes(`\`${strippedTarget}\``)
      ) {
        return i + 1;
      }
    }
  }

  // 3. Extract candidate phrases (handles "Suite > should do X" or "file.js · func() standard execution")
  const candidatePhrases = [strippedTarget];
  if (strippedTarget.includes(" > ")) {
    const parts = strippedTarget.split(" > ");
    candidatePhrases.push(parts[parts.length - 1].trim());
  }
  if (strippedTarget.includes(" · ")) {
    const parts = strippedTarget.split(" · ");
    candidatePhrases.push(parts[parts.length - 1].trim());
  }
  const strippedParens = strippedTarget.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (strippedParens && strippedParens !== strippedTarget) {
    candidatePhrases.push(strippedParens);
    if (strippedParens.includes(" > ")) {
      candidatePhrases.push(strippedParens.split(" > ").pop().trim());
    }
    if (strippedParens.includes(" · ")) {
      candidatePhrases.push(strippedParens.split(" · ").pop().trim());
    }
  }
  const fnMatch = strippedTarget.match(/([a-zA-Z0-9_$]+)\s*\(\)/);
  if (fnMatch) {
    candidatePhrases.push(fnMatch[1]);
  }

  // 4. Test suite specific matching: it('phrase'...) or test('phrase'...)
  for (const phrase of candidatePhrases) {
    if (!phrase || phrase.length < 3) continue;
    const lowerPhrase = phrase.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();
      if (
        (lowerLine.includes("it(") || lowerLine.includes("it (") ||
         lowerLine.includes("it.only") || lowerLine.includes("it.skip") ||
         lowerLine.includes("test(") || lowerLine.includes("test (") ||
         lowerLine.includes("test.only") || lowerLine.includes("test.skip") ||
         lowerLine.includes("describe(") || lowerLine.includes("describe (")) &&
        lowerLine.includes(lowerPhrase)
      ) {
        return i + 1;
      }
    }
  }

  // 5. Function declaration / method definition matching
  for (const phrase of candidatePhrases) {
    if (!phrase || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(phrase)) continue;
    const fnRegexes = [
      new RegExp(`(?:function|const|let|var|async)\\s+${phrase}\\b`),
      new RegExp(`(?:^|\\s)${phrase}\\s*\\([^)]*\\)\\s*\\{`),
      new RegExp(`(?:^|\\s)${phrase}\\s*=\\s*(?:async\\s*)?\\(`),
      new RegExp(`(?:^|\\s)${phrase}\\s*:\\s*(?:async\\s*)?function`),
    ];
    for (let i = 0; i < lines.length; i++) {
      for (const re of fnRegexes) {
        if (re.test(lines[i])) {
          return i + 1;
        }
      }
    }
  }

  // 6. Substring match fallback
  for (const phrase of candidatePhrases) {
    if (!phrase || phrase.length < 4) continue;
    const lowerPhrase = phrase.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerPhrase)) {
        return i + 1;
      }
    }
  }

  return null;
};

/**
 * Resolves the full start and end line range of a unit test case (it / test block),
 * and the specific line where the target function is invoked.
 *
 * Priority order:
 * 1. targetTestTitle: When user selects a specific test scenario, match that exact test block,
 *    and find the targetFunction invocation inside THAT block.
 * 2. targetTestLine: When a specific test line number is provided, locate its enclosing block.
 * 3. targetFunction: Fallback when no scenario was specified, find the first test exercising targetFunction.
 *
 * @param {string} content - Raw test file content
 * @param {object} options
 * @param {string} [options.targetFunction] - Business function name being exercised (e.g. "getLawConfig")
 * @param {string} [options.targetTestTitle] - Test scenario title (e.g. "should return correct config for ccpa")
 * @param {number} [options.targetTestLine] - Known line number
 * @returns {{ startLine: number, endLine: number, callLine: number|null } | null}
 */
export const resolveTestBlockRange = (
  content,
  { targetFunction = null, targetTestTitle = null, targetTestLine = null } = {}
) => {
  if (!content || typeof content !== "string") return null;
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return null;

  let startLine = null;
  let endLine = null;
  let callLine = null;

  const isTestDeclaration = (lineStr) => {
    return /^\s*(?:it|test|xit|fit)\s*(?:\.(?:only|skip|each|concurrent))?\s*\(/.test(lineStr);
  };

  const computeBlockEnd = (startIdx) => {
    let braceDepth = 0;
    let foundOpenBrace = false;
    let inBlockComment = false;

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let inTemplate = false;

      for (let j = 0; j < line.length; j++) {
        const c = line[j];
        const prev = j > 0 ? line[j - 1] : "";
        const next = j + 1 < line.length ? line[j + 1] : "";

        // Comments
        if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
          if (inBlockComment) {
            if (c === "*" && next === "/") {
              inBlockComment = false;
              j++;
            }
            continue;
          }
          if (c === "/" && next === "*") {
            inBlockComment = true;
            j++;
            continue;
          }
          if (c === "/" && next === "/") {
            break; // rest of line is comment
          }
        }

        if (inBlockComment) continue;

        // Strings
        if (c === "'" && !inDoubleQuote && !inTemplate && prev !== "\\") {
          inSingleQuote = !inSingleQuote;
          continue;
        }
        if (c === '"' && !inSingleQuote && !inTemplate && prev !== "\\") {
          inDoubleQuote = !inDoubleQuote;
          continue;
        }
        if (c === "`" && !inSingleQuote && !inDoubleQuote && prev !== "\\") {
          inTemplate = !inTemplate;
          continue;
        }

        if (inSingleQuote || inDoubleQuote || inTemplate) continue;

        // Count braces
        if (c === "{") {
          braceDepth++;
          foundOpenBrace = true;
        } else if (c === "}") {
          if (foundOpenBrace) {
            braceDepth--;
            if (braceDepth <= 0) {
              return i + 1; // 1-indexed
            }
          }
        }
      }
    }

    // Fallback: search for ending `});` or `})` within 60 lines
    for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 60); i++) {
      if (/^\s*\}\s*\)\s*;?\s*$/.test(lines[i])) {
        return i + 1;
      }
    }
    return Math.min(lines.length, startIdx + 15);
  };

  // Helper to locate invocation of targetFunction within line range [sLine, eLine]
  const findFunctionCallInBlock = (sLine, eLine) => {
    if (!targetFunction || typeof targetFunction !== "string") return null;
    const cleanFn = targetFunction.replace(/\(\)$/, "").trim();
    if (!cleanFn) return null;

    const callRegex = new RegExp(`(?:\\.|\\b)${cleanFn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`);
    const refRegex = new RegExp(`\\b${cleanFn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

    for (let i = sLine - 1; i < Math.min(lines.length, eLine); i++) {
      const line = lines[i];
      if (line.includes("import ") || line.includes("require(")) continue;
      if (callRegex.test(line) || refRegex.test(line)) {
        return i + 1; // 1-indexed
      }
    }
    return null;
  };

  // 1. Priority 1: Match by targetTestTitle (Specific scenario requested by user)
  if (targetTestTitle && typeof targetTestTitle === "string") {
    const cleanTitle = targetTestTitle.replace(/^[✓✗⚠️]\s*/, "").trim();
    const candidateTitles = [cleanTitle];
    if (cleanTitle.includes(" > ")) {
      candidateTitles.push(cleanTitle.split(" > ").pop().trim());
    }
    if (cleanTitle.includes(" · ")) {
      candidateTitles.push(cleanTitle.split(" · ").pop().trim());
    }
    const strippedParens = cleanTitle.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (strippedParens && strippedParens !== cleanTitle) {
      candidateTitles.push(strippedParens);
      if (strippedParens.includes(" > ")) candidateTitles.push(strippedParens.split(" > ").pop().trim());
      if (strippedParens.includes(" · ")) candidateTitles.push(strippedParens.split(" · ").pop().trim());
    }

    let foundTestStart = null;

    // Pass A: Exact test declaration matching candidate title
    for (const cand of candidateTitles) {
      if (!cand || cand.length < 3) continue;
      const lowerCand = cand.toLowerCase();
      const matchedStarts = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isTestDeclaration(line)) {
          const lowerLine = line.toLowerCase();
          if (
            lowerLine.includes(`"${lowerCand}"`) ||
            lowerLine.includes(`'${lowerCand}'`) ||
            lowerLine.includes(`\`${lowerCand}\``) ||
            lowerLine.includes(lowerCand)
          ) {
            matchedStarts.push(i + 1);
          }
        }
      }

      if (matchedStarts.length === 1) {
        foundTestStart = matchedStarts[0];
        break;
      } else if (matchedStarts.length > 1) {
        // If multiple tests match, prioritize the one that invokes targetFunction
        const best = matchedStarts.find((s) => {
          const e = computeBlockEnd(s - 1);
          return Boolean(findFunctionCallInBlock(s, e));
        });
        foundTestStart = best || matchedStarts[0];
        break;
      }
    }

    // Pass B: Candidate title inside test body or multiline declaration, backtrack to enclosing test declaration
    if (!foundTestStart) {
      for (const cand of candidateTitles) {
        if (!cand || cand.length < 3) continue;
        const lowerCand = cand.toLowerCase();

        for (let i = 0; i < lines.length; i++) {
          const lowerLine = lines[i].toLowerCase();
          if (
            lowerLine.includes(`"${lowerCand}"`) ||
            lowerLine.includes(`'${lowerCand}'`) ||
            lowerLine.includes(`\`${lowerCand}\``) ||
            lowerLine.includes(lowerCand)
          ) {
            for (let j = i; j >= Math.max(0, i - 15); j--) {
              if (isTestDeclaration(lines[j])) {
                foundTestStart = j + 1;
                break;
              }
            }
            if (foundTestStart) break;
            foundTestStart = i + 1;
            break;
          }
        }
        if (foundTestStart) break;
      }
    }

    // Pass C: Fallback using resolveTestOrFunctionLine
    if (!foundTestStart) {
      const fallbackLine = resolveTestOrFunctionLine(content, cleanTitle, true);
      if (fallbackLine && fallbackLine > 0) {
        for (let j = fallbackLine - 1; j >= Math.max(0, fallbackLine - 15); j--) {
          if (isTestDeclaration(lines[j])) {
            foundTestStart = j + 1;
            break;
          }
        }
        if (!foundTestStart) foundTestStart = fallbackLine;
      }
    }

    if (foundTestStart) {
      startLine = foundTestStart;
      endLine = computeBlockEnd(startLine - 1);
      callLine = findFunctionCallInBlock(startLine, endLine) || startLine;
      return { startLine, endLine, callLine };
    }
  }

  // 2. Priority 2: Specific test line (targetTestLine)
  if (targetTestLine && Number(targetTestLine) > 0) {
    const tLine = Number(targetTestLine);
    let sLine = tLine;
    if (sLine <= lines.length) {
      if (!isTestDeclaration(lines[sLine - 1])) {
        for (let j = sLine - 1; j >= Math.max(0, sLine - 25); j--) {
          if (isTestDeclaration(lines[j])) {
            sLine = j + 1;
            break;
          }
        }
      }
      startLine = sLine;
      endLine = computeBlockEnd(startLine - 1);
      callLine = findFunctionCallInBlock(startLine, endLine) || tLine;
      return { startLine, endLine, callLine };
    }
  }

  // 3. Priority 3: Fallback by targetFunction (Direct function search across file when no specific scenario is given)
  if (targetFunction && typeof targetFunction === "string") {
    const cleanFn = targetFunction.replace(/\(\)$/, "").trim();
    if (cleanFn.length > 0) {
      const callRegex = new RegExp(`(?:\\.|\\b)${cleanFn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`);
      const refRegex = new RegExp(`\\b${cleanFn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("import ") || line.includes("require(")) continue;

        if (callRegex.test(line) || refRegex.test(line)) {
          const foundCallLine = i + 1;
          let foundStart = null;
          for (let j = i; j >= 0; j--) {
            if (isTestDeclaration(lines[j])) {
              foundStart = j + 1;
              break;
            }
          }
          if (foundStart) {
            const foundEnd = computeBlockEnd(foundStart - 1);
            if (foundCallLine >= foundStart && foundCallLine <= foundEnd) {
              return {
                startLine: foundStart,
                endLine: foundEnd,
                callLine: foundCallLine,
              };
            }
          }
        }
      }
    }
  }

  return null;
};


