import fs from "fs";
import path from "path";

/**
 * Categorizes the root cause of a test failure based on message and stack trace.
 *
 * @param {string} message
 * @param {string} stack
 * @returns {string} Failure category
 */
export const categorizeFailureReason = (message = "", stack = "") => {
  const text = `${message} ${stack}`.toLowerCase();

  if (text.includes("timeout") || text.includes("timed out") || text.includes("exceeded")) {
    return "TIMEOUT";
  }
  if (
    text.includes("not found") ||
    text.includes("not visible") ||
    text.includes("detached") ||
    text.includes("waiting for locator") ||
    text.includes("element is not attached")
  ) {
    return "ELEMENT_NOT_FOUND";
  }
  if (
    text.includes("expect(") ||
    text.includes("assertionerror") ||
    text.includes("expected") ||
    text.includes("to be") ||
    text.includes("to have")
  ) {
    return "ASSERTION_FAILED";
  }
  if (
    text.includes("500") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504") ||
    text.includes("econnrefused") ||
    text.includes("failed to fetch") ||
    text.includes("net::err")
  ) {
    return "SERVER_ERROR";
  }
  if (text.includes("navigation failed") || text.includes("page.goto") || text.includes("cy.visit")) {
    return "NAVIGATION_ERROR";
  }
  if (text.includes("syntaxerror") || text.includes("referenceerror") || text.includes("typeerror")) {
    return "SYNTAX_ERROR";
  }

  return "GENERAL_ERROR";
};

/**
 * Extracts the specific action or assertion step that was executing when the failure occurred.
 *
 * @param {Object} options
 * @param {string} [options.snippet]
 * @param {string} [options.message]
 * @param {string} [options.stack]
 * @returns {string|null} The failure step command
 */
export const extractFailureStep = ({ snippet = "", message = "", stack = "" }) => {
  // 1. From Playwright code snippet marked with '>'
  if (snippet && typeof snippet === "string") {
    const activeLine = snippet
      .split("\n")
      .find((line) => line.trim().startsWith(">"));
    if (activeLine) {
      const cleaned = activeLine.trim().replace(/^>\s*\d*\s*\|?\s*/, "").trim();
      if (cleaned) return cleaned;
    }
  }

  // 2. From call log or locator in message:
  // e.g. "waiting for getByRole('button', { name: 'Submit' })"
  const waitingMatch = message.match(/waiting for\s+([^(\n]+(?:\([^)]*\))?)/i);
  if (waitingMatch) {
    return `waiting for ${waitingMatch[1].trim()}`;
  }

  // 3. E.g. "Expected to find element: `button#checkout`, but never found it."
  const cypressElemMatch = message.match(/Expected to find element:\s*`([^`]+)`/i);
  if (cypressElemMatch) {
    return `cy.get('${cypressElemMatch[1]}')`;
  }

  // 4. From Playwright action method in error/stack
  const actionMatch = `${message}\n${stack}`.match(
    /\b(await\s+page\.(?:click|goto|fill|locator|waitForSelector|waitForTimeout|getBy\w+)\([^)]*\))/i
  );
  if (actionMatch) {
    return actionMatch[1].trim();
  }

  // 5. From expect assertion line
  const expectMatch = `${message}\n${stack}`.match(
    /\b(await\s+expect\([^)]*\)\.\w+\([^)]*\))/i
  );
  if (expectMatch) {
    return expectMatch[1].trim();
  }

  return null;
};

/**
 * Extracts line number and file path from stack trace, then reads surrounding source code.
 *
 * @param {Object} options
 * @param {string} options.stack
 * @param {string} [options.testFile]
 * @param {string} [options.rootDir]
 * @param {string} [options.snippet]
 * @returns {string|null} Formatted code snippet
 */
export const extractFailureCodeSnippet = ({ stack = "", testFile = null, rootDir = null, snippet = null }) => {
  if (snippet && typeof snippet === "string" && snippet.trim()) {
    return snippet.trim();
  }

  if (!stack || typeof stack !== "string") return null;

  // Match: at ... (tests/e2e/file.spec.js:28:15) or at file.spec.js:28:15
  const lineMatch = stack.match(/(?:at\s+.*?\s+\(?|at\s+)(?:.*?\/)?([^/\\:\s]+\.(?:spec|cy|test)\.[cm]?[jt]sx?):(\d+):(\d+)\)?/i);
  if (!lineMatch) return null;

  const matchedFileName = lineMatch[1];
  const errorLineNumber = parseInt(lineMatch[2], 10);

  if (rootDir && errorLineNumber > 0) {
    const candidatePaths = [
      testFile ? path.join(rootDir, testFile) : null,
      path.join(rootDir, "tests", "e2e", matchedFileName),
      path.join(rootDir, "cypress", "e2e", matchedFileName),
      path.join(rootDir, matchedFileName),
    ].filter(Boolean);

    for (const targetPath of candidatePaths) {
      if (fs.existsSync(targetPath)) {
        try {
          const lines = fs.readFileSync(targetPath, "utf8").split("\n");
          const start = Math.max(0, errorLineNumber - 3);
          const end = Math.min(lines.length, errorLineNumber + 2);

          const result = [];
          for (let i = start; i < end; i++) {
            const lineNum = i + 1;
            const marker = lineNum === errorLineNumber ? ">" : " ";
            result.push(`${marker} ${lineNum} | ${lines[i]}`);
          }
          return result.join("\n");
        } catch (_) {
          // Ignore read error and fallback
        }
      }
    }
  }

  return `> ${errorLineNumber} | (Error at ${matchedFileName}:${errorLineNumber})`;
};

/**
 * Extracts DOM or HTML element context from error text or page snapshot.
 *
 * @param {string} message
 * @param {string} [pageSnapshot]
 * @returns {string|null} DOM snapshot snippet
 */
export const extractDomSnapshot = (message = "", pageSnapshot = "") => {
  if (pageSnapshot && typeof pageSnapshot === "string" && pageSnapshot.trim()) {
    return pageSnapshot.slice(0, 4000);
  }

  // Look for HTML markup inside error message: e.g. Received: <button class="btn">...</button>
  const htmlMatch = message.match(/<([a-z0-9-]+)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/i);
  if (htmlMatch) {
    return htmlMatch[0].slice(0, 1000);
  }

  const singleTagMatch = message.match(/<([a-z0-9-]+)(?:\s+[^>]*)?\s*\/?>/i);
  if (singleTagMatch) {
    return singleTagMatch[0];
  }

  return null;
};

/**
 * Analyzes failure breakpoint details for a test scenario.
 *
 * @param {Object} options
 * @param {string} [options.message]
 * @param {string} [options.stack]
 * @param {string} [options.testFile]
 * @param {string} [options.rootDir]
 * @param {string} [options.snippet]
 * @param {string} [options.pageSnapshot]
 * @returns {Object} Structured breakpoint analysis
 */
export const analyzeFailureBreakpoint = ({
  message = "",
  stack = "",
  testFile = null,
  rootDir = null,
  snippet = null,
  pageSnapshot = null,
} = {}) => {
  const failureCategory = categorizeFailureReason(message, stack);
  const failureStep = extractFailureStep({ snippet, message, stack });
  const failureCodeSnippet = extractFailureCodeSnippet({ stack, testFile, rootDir, snippet });
  const domSnapshot = extractDomSnapshot(message, pageSnapshot);

  return {
    failureCategory,
    failureStep,
    failureCodeSnippet,
    domSnapshot,
  };
};
