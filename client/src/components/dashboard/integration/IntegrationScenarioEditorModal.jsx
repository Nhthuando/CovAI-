import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Editor from "@monaco-editor/react";
import {
  X,
  Sparkles,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  AlignLeft,
} from "lucide-react";
import { useTheme } from "../../../contexts/ThemeContext";

const METHOD_STYLES = {
  GET: "bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20",
  POST: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  PUT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PATCH: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  DELETE: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const CATEGORIES = [
  { id: "HAPPY_PATH", label: "Happy Path", status: 200, prefix: "happy path" },
  { id: "VALIDATION", label: "Validation (400)", status: 400, prefix: "validation edge case" },
  { id: "NOT_FOUND", label: "Not Found (404)", status: 404, prefix: "error edge case" },
  { id: "RESILIENCY", label: "Resiliency (500)", status: 500, prefix: "resiliency error case" },
];

export const VALID_JEST_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toBeNull",
  "toBeUndefined",
  "toBeDefined",
  "toBeTruthy",
  "toBeFalsy",
  "toBeNaN",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeCloseTo",
  "toMatch",
  "toContain",
  "toContainEqual",
  "toHaveLength",
  "toHaveProperty",
  "toBeInstanceOf",
  "toThrow",
  "toThrowError",
  "toMatchObject",
  "toMatchSnapshot",
  "toMatchInlineSnapshot",
  "toHaveBeenCalled",
  "toBeCalled",
  "toHaveBeenCalledTimes",
  "toBeCalledTimes",
  "toHaveBeenCalledWith",
  "toBeCalledWith",
  "toHaveBeenLastCalledWith",
  "toHaveReturned",
  "toHaveReturnedTimes",
  "toHaveReturnedWith",
  "any",
  "anything",
  "arrayContaining",
  "objectContaining",
  "stringContaining",
  "stringMatching",
]);

export const JEST_MODIFIERS = new Set(["not", "resolves", "rejects"]);

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

export function findClosestMatcher(name) {
  let closest = "toBe";
  let minDistance = Infinity;
  for (const m of VALID_JEST_MATCHERS) {
    const dist = levenshtein(name.toLowerCase(), m.toLowerCase());
    if (dist < minDistance) {
      minDistance = dist;
      closest = m;
    }
  }
  return closest;
}

export function buildSupertestTemplate({
  method = "GET",
  path = "/",
  title = "",
  expectedStatus = 200,
}) {
  const m = method.toLowerCase();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const safeTitle = (title || `should handle ${method} ${cleanPath} successfully`).replace(/'/g, "\\'");
  const hasBody = ["post", "put", "patch"].includes(m);

  if (hasBody) {
    return `it('${safeTitle}', async () => {\n  // Arrange\n  const payload = {};\n\n  // Act\n  const response = await request(app)\n    .${m}('${cleanPath}')\n    .send(payload);\n\n  // Assert\n  expect(response.status).toBe(${expectedStatus});\n});`;
  }

  return `it('${safeTitle}', async () => {\n  // Act\n  const response = await request(app)\n    .${m}('${cleanPath}');\n\n  // Assert\n  expect(response.status).toBe(${expectedStatus});\n});`;
}

function extractTestName(code) {
  if (!code) return "";
  const match = code.match(/(?:it|test)\s*\(\s*(['"`])(.*?)\1/);
  return match ? match[2] : "";
}

function replaceTestNameInCode(code, newName) {
  if (!code) return code;
  const safe = newName.replace(/'/g, "\\'");
  return code.replace(/((?:it|test)\s*\(\s*)(['"`])(.*?)\2/, `$1'${safe}'`);
}

/**
 * Computes exact Monaco Markers with line/column coordinates for IDE red squiggly underlines.
 */
export function getScenarioMonacoMarkers(code = "", targetEndpoint = null) {
  const markers = [];
  const lines = code.split("\n");

  // 1. Check for basic test block
  const hasTestBlock = /(?:it|test)\s*\(\s*(['"`])(.*?)\1/.test(code);
  if (!hasTestBlock && code.trim().length > 0) {
    markers.push({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: Math.max(lines[0]?.length || 1, 10),
      message: "Missing test block: Scenario must contain 'it(\"...\")' or 'test(\"...\")'.",
      severity: 8, // MarkerSeverity.Error
    });
  }

  // 2. Check for Supertest API call
  const hasRequestCall = /request\s*\(\s*(?:app|server)?\s*\)/i.test(code);
  if (!hasRequestCall && code.trim().length > 0) {
    markers.push({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: Math.max(lines[0]?.length || 1, 10),
      message: "Missing Supertest call: Scenario must execute 'await request(app).<method>(...)'.",
      severity: 8,
    });
  }

  // 3. Scan line-by-line for tokens
  lines.forEach((lineText, lineIdx) => {
    const lineNum = lineIdx + 1;

    // A. Detect Supertest method typo: e.g. request(app).gett(...)
    const reqMethodMatch = lineText.match(/(?:request\s*\(\s*(?:app|server)?\s*\)\s*\.)([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (reqMethodMatch) {
      const calledMethod = reqMethodMatch[1];
      const validVerbs = ["get", "post", "put", "patch", "delete", "head", "options"];
      if (!validVerbs.includes(calledMethod.toLowerCase())) {
        const colStart = lineText.indexOf(`.${calledMethod}`) + 2;
        markers.push({
          startLineNumber: lineNum,
          startColumn: colStart,
          endLineNumber: lineNum,
          endColumn: colStart + calledMethod.length,
          message: `Invalid Supertest method '.${calledMethod}()'. Valid methods: get, post, put, patch, delete.`,
          severity: 8,
        });
      }
    }

    // B. Detect Jest matchers chained to expect(...): e.g. expect(...).toBee(200)
    const matcherCallRegex = /\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;
    while ((match = matcherCallRegex.exec(lineText)) !== null) {
      const propName = match[1];
      const isBeforeExpect = lineText.indexOf("expect(") !== -1 && lineText.indexOf("expect(") < match.index;
      const isSupertestVerb = ["get", "post", "put", "patch", "delete", "send", "set", "query", "expect"].includes(propName);

      if (isBeforeExpect && !isSupertestVerb) {
        if (!VALID_JEST_MATCHERS.has(propName) && !JEST_MODIFIERS.has(propName)) {
          const closest = findClosestMatcher(propName);
          const colStart = match.index + 2;
          markers.push({
            startLineNumber: lineNum,
            startColumn: colStart,
            endLineNumber: lineNum,
            endColumn: colStart + propName.length,
            message: `Invalid Jest matcher '.${propName}()'. Did you mean '.${closest}()'?`,
            severity: 8,
          });
        }
      }
    }

    // C. Detect invalid HTTP status code: e.g. expect(response.status).toBe(2000)
    const statusAssertRegex = /(?:response|res)\.(?:status|statusCode)\s*\)\s*(?:\.not)?\s*\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*(\d+)\s*\)/g;
    let statusMatch;
    while ((statusMatch = statusAssertRegex.exec(lineText)) !== null) {
      const codeVal = parseInt(statusMatch[1], 10);
      if (codeVal < 100 || codeVal > 599) {
        const numStr = statusMatch[1];
        const numIndex = lineText.indexOf(numStr, statusMatch.index);
        const colStart = numIndex + 1;
        markers.push({
          startLineNumber: lineNum,
          startColumn: colStart,
          endLineNumber: lineNum,
          endColumn: colStart + numStr.length,
          message: `Invalid HTTP status code ${codeVal}. Expected standard HTTP status between 100 and 599.`,
          severity: 8,
        });
      }
    }

    // D. Target endpoint method mismatch warning
    if (targetEndpoint) {
      const expectedMethod = (targetEndpoint.method || "GET").toLowerCase();
      const mMatch = lineText.match(/request\s*\(\s*(?:app|server)?\s*\)\s*\.([a-zA-Z]+)/i);
      if (mMatch && mMatch[1]) {
        const codeMethod = mMatch[1].toLowerCase();
        if (
          codeMethod !== expectedMethod &&
          ["get", "post", "put", "patch", "delete"].includes(codeMethod)
        ) {
          const colStart = lineText.indexOf(`.${mMatch[1]}`) + 2;
          markers.push({
            startLineNumber: lineNum,
            startColumn: colStart,
            endLineNumber: lineNum,
            endColumn: colStart + mMatch[1].length,
            message: `Warning: Code calls .${codeMethod.toUpperCase()}() while target API is ${expectedMethod.toUpperCase()}.`,
            severity: 4,
          });
        }
      }
    }
  });

  // 4. Check syntax via JS compiler
  try {
    new Function(
      "request",
      "app",
      "expect",
      "it",
      "test",
      "beforeEach",
      "afterEach",
      "describe",
      code
    );
  } catch (err) {
    if (!markers.some((m) => m.severity === 8 && m.message.includes("matcher"))) {
      let errLine = lines.length;
      const lineMatch = err.message.match(/line\s*(\d+)/i) || err.stack?.match(/:(\d+):\d+/);
      if (lineMatch && lineMatch[1]) {
        errLine = Math.min(parseInt(lineMatch[1], 10), lines.length);
      }
      markers.push({
        startLineNumber: Math.max(1, errLine),
        startColumn: 1,
        endLineNumber: Math.max(1, errLine),
        endColumn: Math.max(lines[errLine - 1]?.length || 1, 10),
        message: `JavaScript syntax error: ${err.message}`,
        severity: 8,
      });
    }
  }

  return markers;
}

export default function IntegrationScenarioEditorModal({
  isOpen,
  onClose,
  onSave,
  initialCode,
  title,
  loading,
  targetEndpoint,
  availableEndpoints = [],
  onSelectTargetEndpoint,
  existingScenarioTitles = [],
  isAddMode = false,
}) {
  const [code, setCode] = useState(initialCode || "");
  const [scenarioName, setScenarioName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("HAPPY_PATH");
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [isCustomEdited, setIsCustomEdited] = useState(false);
  const [markers, setMarkers] = useState([]);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  const { theme } = useTheme();
  const isDark = theme !== "light";

  const effectiveMethod = (targetEndpoint?.method || "GET").toUpperCase();
  const effectivePath = targetEndpoint?.path || targetEndpoint?.route || "/";

  // Initialize modal state on open
  useEffect(() => {
    if (isOpen) {
      if (isAddMode) {
        setIsCustomEdited(false);
        const defaultTitle = `happy path: should handle ${effectiveMethod} ${effectivePath} and return 200`;
        setScenarioName(defaultTitle);
        setSelectedCategory("HAPPY_PATH");
        setExpectedStatus(200);
        const generated = buildSupertestTemplate({
          method: effectiveMethod,
          path: effectivePath,
          title: defaultTitle,
          expectedStatus: 200,
        });
        setCode(generated);
      } else {
        setIsCustomEdited(true);
        setCode(initialCode || "");
        const extracted = extractTestName(initialCode || "");
        setScenarioName(extracted || "Integration Scenario");
      }
    }
  }, [isOpen, isAddMode, effectiveMethod, effectivePath, initialCode]);

  // Synchronize Monaco red squiggly underlines on code changes
  useEffect(() => {
    if (!code) {
      setMarkers([]);
      return;
    }

    const calculatedMarkers = getScenarioMonacoMarkers(code, targetEndpoint);
    setMarkers(calculatedMarkers);

    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        monacoRef.current.editor.setModelMarkers(model, "scenario-validator", calculatedMarkers);
      }
    }
  }, [code, targetEndpoint]);

  // Register completion providers for matchers and supertest verbs
  const handleEditorDidMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register snippet autocompletions for Jest matchers & Supertest methods
    monaco.languages.registerCompletionItemProvider("javascript", {
      triggerCharacters: [".", "("],
      provideCompletionItems: (model, position) => {
        const lineContent = model.getLineContent(position.lineNumber);
        const textUntilPosition = lineContent.substring(0, position.column - 1);

        const suggestions = [];

        // When typing . after expect(...)
        if (textUntilPosition.includes("expect(") || textUntilPosition.endsWith(".")) {
          Array.from(VALID_JEST_MATCHERS).forEach((matcher) => {
            suggestions.push({
              label: matcher,
              kind: monaco.languages.CompletionItemKind.Method,
              insertText: `${matcher}(\${1})`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: `Jest Matcher: .${matcher}()`,
              documentation: `Asserts value matches ${matcher} in Jest runner.`,
            });
          });
        }

        // When typing after request(app).
        if (textUntilPosition.includes("request(") && textUntilPosition.endsWith(".")) {
          ["get", "post", "put", "patch", "delete"].forEach((verb) => {
            suggestions.push({
              label: verb,
              kind: monaco.languages.CompletionItemKind.Method,
              insertText: `${verb}('\${1:/path}')`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: `Supertest ${verb.toUpperCase()} request`,
            });
          });
        }

        return { suggestions };
      },
    });

    // Run initial marker sync
    const initialMarkers = getScenarioMonacoMarkers(code, targetEndpoint);
    setMarkers(initialMarkers);
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, "scenario-validator", initialMarkers);
    }
  }, [code, targetEndpoint]);

  // When user changes category in Add Mode
  const handleCategoryChange = (catId) => {
    setSelectedCategory(catId);
    const cat = CATEGORIES.find((c) => c.id === catId);
    if (!cat) return;
    setExpectedStatus(cat.status);

    const newTitle = `${cat.prefix}: should handle ${effectiveMethod} ${effectivePath} with status ${cat.status}`;
    setScenarioName(newTitle);

    if (!isCustomEdited) {
      const generated = buildSupertestTemplate({
        method: effectiveMethod,
        path: effectivePath,
        title: newTitle,
        expectedStatus: cat.status,
      });
      setCode(generated);
    } else {
      setCode((prev) => replaceTestNameInCode(prev, newTitle));
    }
  };

  // When user edits scenario name
  const handleNameChange = (newName) => {
    setScenarioName(newName);
    if (!isCustomEdited) {
      const generated = buildSupertestTemplate({
        method: effectiveMethod,
        path: effectivePath,
        title: newName,
        expectedStatus,
      });
      setCode(generated);
    } else {
      setCode((prev) => replaceTestNameInCode(prev, newName));
    }
  };

  // Reset to auto-generated template
  const handleResetTemplate = () => {
    setIsCustomEdited(false);
    const generated = buildSupertestTemplate({
      method: effectiveMethod,
      path: effectivePath,
      title: scenarioName,
      expectedStatus,
    });
    setCode(generated);
  };

  // Simple Beautify / Re-indent code
  const handleFormatCode = () => {
    try {
      const lines = code.split("\n");
      let indentLevel = 0;
      const formattedLines = lines.map((rawLine) => {
        const line = rawLine.trim();
        if (!line) return "";

        if (line.startsWith("}") || line.startsWith("})") || line.startsWith("});")) {
          indentLevel = Math.max(0, indentLevel - 1);
        }

        const indent = "  ".repeat(indentLevel);
        const result = indent + line;

        if (
          (line.endsWith("{") || line.endsWith("(") || line.endsWith("=>")) &&
          !line.startsWith("//")
        ) {
          indentLevel++;
        }

        return result;
      });
      setCode(formattedLines.join("\n"));
    } catch {
      // Non-fatal
    }
  };

  // Jump to specific error line and focus editor
  const handleJumpToMarker = (marker) => {
    if (!editorRef.current || !marker) return;
    editorRef.current.revealLineInCenter(marker.startLineNumber);
    editorRef.current.setPosition({
      lineNumber: marker.startLineNumber,
      column: marker.startColumn,
    });
    editorRef.current.focus();
  };

  const errorMarkers = markers.filter((m) => m.severity === 8);
  const isDuplicateTitle =
    isAddMode &&
    existingScenarioTitles.some(
      (t) => t.trim().toLowerCase() === scenarioName.trim().toLowerCase()
    );
  const isTitleEmpty = !scenarioName.trim();
  const hasErrors = errorMarkers.length > 0 || isTitleEmpty || isDuplicateTitle;

  // Validate and submit
  const handleSave = () => {
    if (hasErrors) {
      if (errorMarkers.length > 0) {
        handleJumpToMarker(errorMarkers[0]);
      }
      return;
    }
    onSave(code);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans"
    >
      <div className="w-full max-w-4xl h-[720px] max-h-[94vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-2xl flex flex-col overflow-hidden text-[var(--color-text)]">
        {/* 1. Header */}
        <div className="h-14 px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center shrink-0">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <h3
                id="scenario-editor-title"
                className="text-sm font-bold text-[var(--color-text)] tracking-tight truncate"
              >
                {title || (isAddMode ? "Add Integration Test Scenario" : "Edit Scenario Code")}
              </h3>
              <p className="text-[11px] text-[var(--color-text-muted)] font-mono truncate">
                Supertest Execution & Matcher Verification
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleFormatCode}
              title="Auto-format and re-indent code"
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer shadow-xs"
            >
              <AlignLeft size={12} />
              <span>Format</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              title="Close"
              aria-label="Close"
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 2. Configuration Bar: Scenario Title, Target API, Category */}
        <div className="p-4 bg-[var(--color-surface-secondary)]/40 border-b border-[var(--color-border)] flex flex-col gap-3 shrink-0">
          {/* Row 1: Scenario Title */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label
                htmlFor="scenario-name-input"
                className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5"
              >
                <span>Scenario Title</span>
                <span className="text-rose-500 font-bold">*</span>
              </label>
              {isCustomEdited && (
                <button
                  type="button"
                  onClick={handleResetTemplate}
                  className="text-[11px] text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer font-medium"
                  title="Reset code to standard Supertest template"
                >
                  <RefreshCw size={11} />
                  <span>Reset to Template</span>
                </button>
              )}
            </div>
            <input
              id="scenario-name-input"
              type="text"
              value={scenarioName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. happy path: should return 200 and food item details"
              className={`w-full px-3 py-1.5 text-xs font-sans rounded-[var(--radius-sm)] bg-[var(--color-surface)] border text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none transition-colors shadow-xs ${
                isTitleEmpty || isDuplicateTitle
                  ? "border-rose-500 focus:border-rose-500"
                  : "border-[var(--color-border)] focus:border-[var(--color-primary)]"
              }`}
            />
            {isDuplicateTitle && (
              <span className="text-[11px] text-rose-500 font-medium">
                A scenario with this title already exists in this endpoint.
              </span>
            )}
          </div>

          {/* Row 2: Target API & Category Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Target API Dropdown */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-semibold text-[var(--color-text-secondary)] font-mono shrink-0">
                Target API:
              </span>
              {availableEndpoints && availableEndpoints.length > 0 && onSelectTargetEndpoint ? (
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border tracking-tight ${
                      METHOD_STYLES[effectiveMethod] || METHOD_STYLES.DEFAULT
                    }`}
                  >
                    {effectiveMethod}
                  </span>
                  <select
                    value={`${effectiveMethod} ${effectivePath}`}
                    onChange={(e) => {
                      const found = availableEndpoints.find(
                        (ep) =>
                          `${(ep.method || "GET").toUpperCase()} ${
                            ep.path || ep.route || "/"
                          }` === e.target.value
                      );
                      if (found) {
                        onSelectTargetEndpoint(found);
                        if (!isCustomEdited) {
                          const generated = buildSupertestTemplate({
                            method: found.method,
                            path: found.path || found.route,
                            title: scenarioName,
                            expectedStatus,
                          });
                          setCode(generated);
                        }
                      }
                    }}
                    className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-xs px-2.5 py-1 text-[var(--color-text)] font-mono focus:outline-none focus:border-[var(--color-primary)] shadow-xs"
                  >
                    {availableEndpoints.map((ep) => {
                      const m = (ep.method || "GET").toUpperCase();
                      const p = ep.path || ep.route || "/";
                      return (
                        <option key={`${m} ${p}`} value={`${m} ${p}`}>
                          {m} {p}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 font-mono text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${
                      METHOD_STYLES[effectiveMethod] || METHOD_STYLES.DEFAULT
                    }`}
                  >
                    {effectiveMethod}
                  </span>
                  <span className="text-[var(--color-text)] font-semibold">{effectivePath}</span>
                </div>
              )}
            </div>

            {/* Category Pills (Add Mode) */}
            {isAddMode && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-[var(--color-text-secondary)] font-mono">
                  Category:
                </span>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleCategoryChange(cat.id)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                      selectedCategory === cat.id
                        ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-transparent font-semibold shadow-xs"
                        : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 3. Monaco Editor Area with Native Squiggly Lines & Autocomplete */}
        <div className="flex-1 min-h-0 bg-[var(--color-bg)] relative">
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme={isDark ? "vs-dark" : "light"}
            value={code}
            onMount={handleEditorDidMount}
            onChange={(value) => {
              setCode(value || "");
              setIsCustomEdited(true);
              const extracted = extractTestName(value || "");
              if (extracted && extracted !== scenarioName) {
                setScenarioName(extracted);
              }
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              fontFamily: "var(--font-mono)",
              tabSize: 2,
              quickSuggestions: true,
              suggestOnTriggerCharacters: true,
              wordBasedSuggestions: true,
              hover: { enabled: true, delay: 100 },
              renderLineHighlight: "all",
            }}
          />
        </div>

        {/* 4. Sleek IDE Footer */}
        <div className="h-14 px-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--color-text-muted)] min-w-0">
            <span>{code.length} characters</span>
            {errorMarkers.length > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-rose-500 font-semibold flex items-center gap-1">
                  <AlertCircle size={13} />
                  <span>
                    {errorMarkers.length} {errorMarkers.length === 1 ? "error" : "errors"}
                  </span>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || hasErrors}
              title={
                hasErrors
                  ? "Fix errors highlighted with red squiggly lines before saving"
                  : isAddMode
                    ? "Add Scenario"
                    : "Save Changes"
              }
              className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
            >
              {loading ? "Saving..." : isAddMode ? "Add Scenario" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
