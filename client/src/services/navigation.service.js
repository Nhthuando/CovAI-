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
