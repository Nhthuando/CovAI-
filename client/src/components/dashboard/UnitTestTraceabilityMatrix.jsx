import React, { useState, useMemo } from "react";
import {
  FileCode,
  GitBranch,
  Cpu,
  Layers,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Code2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Filter,
  Sparkles,
  Check,
  X,
  ShieldCheck,
  Zap,
  Target,
  FileCheck,
  FileDiff,
  Loader2,
} from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

/**
 * Helper to classify test category if not provided by backend
 */
const classifyFallback = (title = "", ancestorTitles = []) => {
  const fullText = [title, ...(Array.isArray(ancestorTitles) ? ancestorTitles : [])].join(" ").toLowerCase();
  if (/\b(error|throw|throws|exception|reject|rejects|catch|fail|failed|failure|invalid|malformed|unauthorized|forbidden|not\s*found|crash)\b/i.test(fullText) || /\b(500|400|401|403|404)\b/.test(fullText)) {
    return {
      category: "ERROR_HANDLING",
      categoryName: "D. Error & Exception Handling",
      badge: "Error Handling",
      color: "#ef4444",
      bg: "rgba(239, 68, 68, 0.12)",
      border: "rgba(239, 68, 68, 0.35)",
    };
  }
  if (/\b(bound|boundary|extreme|limits?|edge\s*cases?|empty|zero|\b0\b|-1|negative|null|undefined|nan|max|min|overflow|underflow|whitespace|blank)\b/i.test(fullText) || /\[\s*\]|\{\s*\}|""|''/.test(fullText)) {
    return {
      category: "BOUNDARY_VALUES",
      categoryName: "B. Boundary Values",
      badge: "Boundary Value",
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.12)",
      border: "rgba(245, 158, 11, 0.35)",
    };
  }
  if (/\b(branch|branches|toggle|condition|conditional|if|else|switch|case|when|fallback|default|optional|ternary|without|falsy|truthy|neither|either|boolean|flag)\b/i.test(fullText) || /\b(or|and|\?\?|\|\||\?\.)\b/.test(fullText)) {
    return {
      category: "BRANCH_TOGGLING",
      categoryName: "C. Branch Toggling",
      badge: "Branch Toggling",
      color: "#0284c7",
      bg: "rgba(2, 132, 199, 0.12)",
      border: "rgba(2, 132, 199, 0.35)",
    };
  }
  return {
    category: "HAPPY_PATH",
    categoryName: "A. Happy Path",
    badge: "Happy Path",
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.35)",
  };
};

/**
 * UnitTestTraceabilityMatrix
 * 
 * Provides:
 * 1. 4-Metric Coverage Anatomy: Clear explanation of how Statements, Branches, Functions, Lines are measured.
 * 2. 4-Category Strategy Distribution: Breakdown across Happy Path, Boundary Values, Branch Toggling, Error Handling.
 * 3. Bi-directional Traceability: Maps Business Logic functions to specific test cases and testing techniques.
 */
export default function UnitTestTraceabilityMatrix({
  sourceFiles = [],
  testSuites = [],
  functionsList = [],
  summary = null,
  rawTotals = null,
  onOpenFile,
  onSuggestTestcase,
  inlineSuggestions = {},
  loadingSuggestions = {},
  applyingSuggestionIds = new Set(),
  applyResultsByFile = {},
  onApplySuggestion,
  onApplyAllFileSuggestions,
  onReviewDiff,
  isLight = false,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL"); // "ALL" | "HAPPY_PATH" | "BOUNDARY_VALUES" | "BRANCH_TOGGLING" | "ERROR_HANDLING"
  const [expandedFunctions, setExpandedFunctions] = useState(new Set());
  const [expandedFiles, setExpandedFiles] = useState(new Set());

  // Aggregate all assertions across test suites
  const allAssertions = useMemo(() => {
    const list = [];
    for (const suite of testSuites) {
      if (!Array.isArray(suite.assertions)) continue;
      for (const a of suite.assertions) {
        const catInfo = a.category ? {
          category: a.category,
          categoryName: a.categoryName || a.category,
          badge: a.categoryBadge || a.category,
          color: a.categoryColor || "#10b981",
          bg: a.category === "ERROR_HANDLING" ? "rgba(239, 68, 68, 0.12)" : a.category === "BOUNDARY_VALUES" ? "rgba(245, 158, 11, 0.12)" : a.category === "BRANCH_TOGGLING" ? "rgba(2, 132, 199, 0.12)" : "rgba(16, 185, 129, 0.12)",
          border: a.category === "ERROR_HANDLING" ? "rgba(239, 68, 68, 0.35)" : a.category === "BOUNDARY_VALUES" ? "rgba(245, 158, 11, 0.35)" : a.category === "BRANCH_TOGGLING" ? "rgba(2, 132, 199, 0.35)" : "rgba(16, 185, 129, 0.35)",
        } : classifyFallback(a.title, a.ancestorTitles);

        list.push({
          ...a,
          ...catInfo,
          suiteFileName: suite.fileName,
          suiteFilePath: suite.filePath,
          framework: suite.framework,
        });
      }
    }
    return list;
  }, [testSuites]);

  // Strategy Distribution counts
  const categoryCounts = useMemo(() => {
    const counts = {
      HAPPY_PATH: 0,
      BOUNDARY_VALUES: 0,
      BRANCH_TOGGLING: 0,
      ERROR_HANDLING: 0,
      total: allAssertions.length,
    };
    for (const a of allAssertions) {
      if (counts[a.category] !== undefined) {
        counts[a.category]++;
      } else {
        counts.HAPPY_PATH++;
      }
    }
    return counts;
  }, [allAssertions]);

  // Build mapping: For each business function, find all test assertions that target it
  const functionTraceability = useMemo(() => {
    // Index assertions by target function name (lowercase)
    const assertionsByFunc = new Map();
    for (const a of allAssertions) {
      if (a.targetFunction) {
        const key = a.targetFunction.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!assertionsByFunc.has(key)) assertionsByFunc.set(key, []);
        assertionsByFunc.get(key).push(a);
      }
    }

    // Combine functionsList with matching sourceFiles
    return functionsList.map((fn) => {
      const fnName = fn.displayName || fn.functionName || fn.name || "anonymous";
      const key = fnName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const matchedTests = assertionsByFunc.get(key) || [];

      // Check categories present for this function
      const testsByCategory = {
        HAPPY_PATH: matchedTests.filter((t) => t.category === "HAPPY_PATH"),
        BOUNDARY_VALUES: matchedTests.filter((t) => t.category === "BOUNDARY_VALUES"),
        BRANCH_TOGGLING: matchedTests.filter((t) => t.category === "BRANCH_TOGGLING"),
        ERROR_HANDLING: matchedTests.filter((t) => t.category === "ERROR_HANDLING"),
      };

      const hasHappyPath = testsByCategory.HAPPY_PATH.length > 0;
      const hasBoundary = testsByCategory.BOUNDARY_VALUES.length > 0;
      const hasBranch = testsByCategory.BRANCH_TOGGLING.length > 0;
      const hasError = testsByCategory.ERROR_HANDLING.length > 0;
      const coveredCategoriesCount = [hasHappyPath, hasBoundary, hasBranch, hasError].filter(Boolean).length;

      // Calculate missing categories for guidance
      const missingCategories = [];
      if (!hasHappyPath) missingCategories.push("A. Happy Path");
      if (!hasBoundary) missingCategories.push("B. Boundary Values");
      if (!hasBranch) missingCategories.push("C. Branch Toggling");
      if (!hasError) missingCategories.push("D. Error Handling");

      return {
        ...fn,
        cleanName: fnName,
        tests: matchedTests,
        testCount: matchedTests.length,
        testsByCategory,
        coveredCategoriesCount,
        hasHappyPath,
        hasBoundary,
        hasBranch,
        hasError,
        missingCategories,
      };
    });
  }, [functionsList, allAssertions]);

  // Group functions by source file
  const groupedByFile = useMemo(() => {
    const map = new Map();
    for (const fn of functionTraceability) {
      const fPath = fn.filePath || "unknown";
      if (!map.has(fPath)) {
        // Find file coverage stats from sourceFiles
        const srcMeta = sourceFiles.find((s) => s.filePath === fPath) || null;
        map.set(fPath, {
          filePath: fPath,
          sourceMeta: srcMeta,
          functions: [],
        });
      }
      map.get(fPath).functions.push(fn);
    }
    return Array.from(map.values());
  }, [functionTraceability, sourceFiles]);

  // Filtered files & functions based on search and category filter
  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return groupedByFile
      .map((group) => {
        const matchesFile = !q || group.filePath.toLowerCase().includes(q);

        const filteredFns = group.functions.filter((fn) => {
          // Category filter
          if (selectedCategory !== "ALL") {
            const hasCat = fn.tests.some((t) => t.category === selectedCategory);
            if (!hasCat) return false;
          }

          // Search query match
          if (!q) return true;
          if (matchesFile) return true;
          return (
            fn.cleanName.toLowerCase().includes(q) ||
            fn.tests.some((t) => t.title.toLowerCase().includes(q))
          );
        });

        if (filteredFns.length === 0 && !matchesFile) return null;

        return {
          ...group,
          functions: filteredFns,
        };
      })
      .filter(Boolean);
  }, [groupedByFile, searchQuery, selectedCategory]);

  const toggleExpandFunction = (id) => {
    setExpandedFunctions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpandFile = (fPath) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fPath)) next.delete(fPath);
      else next.add(fPath);
      return next;
    });
  };

  const expandAll = () => {
    const allFnIds = new Set();
    const allFilePaths = new Set();
    for (const group of groupedByFile) {
      allFilePaths.add(group.filePath);
      for (const fn of group.functions) {
        allFnIds.add(`${fn.filePath}:${fn.cleanName}`);
      }
    }
    setExpandedFunctions(allFnIds);
    setExpandedFiles(allFilePaths);
  };

  const collapseAll = () => {
    setExpandedFunctions(new Set());
    setExpandedFiles(new Set());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── 4-Category Strategy Distribution Bar & Filters ── */}
      <div
        style={{
          background: isLight ? "#ffffff" : "var(--color-surface, #11161d)",
          border: isLight ? "1px solid #e2e8f0" : "1px solid var(--color-border, #29313d)",
          borderRadius: 10,
          padding: "14px 18px",
          boxShadow: isLight ? "0 1px 3px rgba(15, 23, 42, 0.05)" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} style={{ color: "#8b5cf6" }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 750, color: isLight ? "#0f172a" : "#f8fafc" }}>
              Test Case Strategy Matrix (4 Categories)
            </div>
            <div style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8" }}>
              Filter business functions by testing category or inspect coverage distribution
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Category A: Happy Path */}
          <div
            onClick={() => setSelectedCategory(selectedCategory === "HAPPY_PATH" ? "ALL" : "HAPPY_PATH")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(16, 185, 129, 0.12)",
              border: selectedCategory === "HAPPY_PATH" ? "1.5px solid #10b981" : "1px solid rgba(16, 185, 129, 0.3)",
              color: isLight ? "#047857" : "#4ade80",
              fontSize: 11.5,
              fontWeight: 650,
              cursor: "pointer",
            }}
            title="Category A: Standard valid inputs, normal flow, and expected state transitions"
          >
            <span>🟢 A. Happy Path:</span>
            <span style={{ fontWeight: 800 }}>{categoryCounts.HAPPY_PATH}</span>
          </div>

          {/* Category B: Boundary Values */}
          <div
            onClick={() => setSelectedCategory(selectedCategory === "BOUNDARY_VALUES" ? "ALL" : "BOUNDARY_VALUES")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(245, 158, 11, 0.12)",
              border: selectedCategory === "BOUNDARY_VALUES" ? "1.5px solid #f59e0b" : "1px solid rgba(245, 158, 11, 0.3)",
              color: isLight ? "#b45309" : "#fbbf24",
              fontSize: 11.5,
              fontWeight: 650,
              cursor: "pointer",
            }}
            title="Category B: Boundary analysis (0, -1, MAX values, empty arrays [], empty strings, null/undefined)"
          >
            <span>🟡 B. Boundary Values:</span>
            <span style={{ fontWeight: 800 }}>{categoryCounts.BOUNDARY_VALUES}</span>
          </div>

          {/* Category C: Branch Toggling */}
          <div
            onClick={() => setSelectedCategory(selectedCategory === "BRANCH_TOGGLING" ? "ALL" : "BRANCH_TOGGLING")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(2, 132, 199, 0.12)",
              border: selectedCategory === "BRANCH_TOGGLING" ? "1.5px solid #0284c7" : "1px solid rgba(2, 132, 199, 0.3)",
              color: isLight ? "#0369a1" : "#38bdf8",
              fontSize: 11.5,
              fontWeight: 650,
              cursor: "pointer",
            }}
            title="Category C: Branch toggling (True vs False paths, fallback ??, logical || operators)"
          >
            <span>🔵 C. Branch Toggling:</span>
            <span style={{ fontWeight: 800 }}>{categoryCounts.BRANCH_TOGGLING}</span>
          </div>

          {/* Category D: Error & Exception Handling */}
          <div
            onClick={() => setSelectedCategory(selectedCategory === "ERROR_HANDLING" ? "ALL" : "ERROR_HANDLING")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.12)",
              border: selectedCategory === "ERROR_HANDLING" ? "1.5px solid #ef4444" : "1px solid rgba(239, 68, 68, 0.3)",
              color: isLight ? "#b91c1c" : "#f87171",
              fontSize: 11.5,
              fontWeight: 650,
              cursor: "pointer",
            }}
            title="Category D: Error and exception handling (throw Error, catch blocks, rejected promises, mock dependency failures)"
          >
            <span>🔴 D. Error Handling:</span>
            <span style={{ fontWeight: 800 }}>{categoryCounts.ERROR_HANDLING}</span>
          </div>

          {selectedCategory !== "ALL" && (
            <button
              onClick={() => setSelectedCategory("ALL")}
              style={{
                background: "transparent",
                border: "none",
                color: isLight ? "#4f46e5" : "#a5b4fc",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Clear Filter
            </button>
          )}
        </div>
      </div>

      {/* ── SECTION 2: Bi-directional Traceability Matrix Explorer ── */}
      <div
        style={{
          background: isLight ? "#ffffff" : "var(--color-surface, #11161d)",
          border: isLight ? "1px solid #e2e8f0" : "1px solid var(--color-border, #29313d)",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: isLight ? "0 1px 3px rgba(15, 23, 42, 0.05)" : "none",
        }}
      >
        {/* Explorer Header with Search & Controls */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 750, color: isLight ? "#0f172a" : "#f8fafc" }}>
              Business Logic ↔ Test Case Traceability Matrix
            </span>
            <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e", fontWeight: 500 }}>
              ({filteredFiles.length} source files · {functionTraceability.length} business functions)
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Search Input */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.04)",
                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 12,
              }}
            >
              <Search size={13} style={{ color: isLight ? "#64748b" : "#8b949e" }} />
              <input
                type="text"
                placeholder="Search function or source file..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: isLight ? "#0f172a" : "#e6edf3",
                  fontSize: 12,
                  width: 200,
                }}
              />
              {searchQuery && (
                <X size={12} style={{ cursor: "pointer", color: "#8b949e" }} onClick={() => setSearchQuery("")} />
              )}
            </div>

            {/* Expand / Collapse All */}
            <button
              onClick={expandAll}
              style={{
                background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 5,
                padding: "4px 8px",
                fontSize: 11,
                fontWeight: 600,
                color: isLight ? "#475569" : "#cbd5e1",
                cursor: "pointer",
              }}
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              style={{
                background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 5,
                padding: "4px 8px",
                fontSize: 11,
                fontWeight: 600,
                color: isLight ? "#475569" : "#cbd5e1",
                cursor: "pointer",
              }}
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Traceability List */}
        {filteredFiles.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: isLight ? "#64748b" : "#8b949e" }}>
            <FileCode size={28} style={{ margin: "0 auto 10px", opacity: 0.5 }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>No matching business functions found</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>
              Try searching with different keywords or switch to "All Categories".
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {filteredFiles.map((group) => {
              const isFileExpanded = expandedFiles.has(group.filePath);
              const meta = group.sourceMeta;

              return (
                <div
                  key={group.filePath}
                  style={{
                    borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.04)",
                  }}
                >
                  {/* File Row Header */}
                  <div
                    onClick={() => toggleExpandFile(group.filePath)}
                    style={{
                      padding: "10px 18px",
                      background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      userSelect: "none",
                      transition: "background 0.15s ease",
                    }}
                    className={isLight ? "hover:bg-slate-100" : "hover:bg-white/[0.04]"}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {isFileExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <FileCode size={14} style={{ color: "#6366f1" }} />
                      <span
                        style={{
                          fontSize: 12.5,
                          fontFamily: "var(--font-mono)",
                          fontWeight: 700,
                          color: isLight ? "#0f172a" : "#f8fafc",
                        }}
                      >
                        {cleanDisplayPath(group.filePath)}
                      </span>
                      <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e" }}>
                        ({group.functions.length} business functions)
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* File Coverage Badges if available */}
                      {meta && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "var(--font-mono)" }}>
                          <span style={{ color: Number(meta.linesPct) >= 100 ? "#10b981" : "#f59e0b" }}>
                            Lines: {meta.linesPct}%
                          </span>
                          <span style={{ color: Number(meta.branchesPct) >= 100 ? "#10b981" : "#f59e0b" }}>
                            Branches: {meta.branchesPct}%
                          </span>
                        </div>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenFile?.(group.filePath);
                        }}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
                          border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
                          color: isLight ? "#475569" : "#cbd5e1",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                        title="Open source file in editor"
                      >
                        Open file
                      </button>
                    </div>
                  </div>

                  {/* Functions in this file */}
                  {isFileExpanded && (
                    <div style={{ padding: "8px 18px 14px 34px", display: "flex", flexDirection: "column", gap: 10 }}>
                      {group.functions.map((fn) => {
                        const fnId = `${fn.filePath}:${fn.cleanName}`;
                        const isFnExpanded = expandedFunctions.has(fnId);
                        const isCovered = fn.hit > 0 || fn.tests.length > 0;
                        const fileSugs = inlineSuggestions[fn.filePath] || [];
                        const isSuggesting = loadingSuggestions[fn.filePath] || false;
                        const hasPending = fileSugs.some((s) => s.status !== "PASSED" && s.status !== "APPLIED");
                        const isApplying = fileSugs.some((s) => applyingSuggestionIds?.has?.(s.suggestionId || s.id));
                        const hasPassed = fileSugs.some((s) => s.status === "PASSED" || s.status === "APPLIED");
                        const hasFailed = fileSugs.some((s) => s.status === "FAILED");

                        return (
                          <div
                            key={fnId}
                            style={{
                              borderRadius: 8,
                              background: isLight ? "#ffffff" : "rgba(15, 23, 42, 0.5)",
                              border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.07)",
                              overflow: "hidden",
                            }}
                          >
                            {/* Function Header Row */}
                            <div
                              onClick={() => toggleExpandFunction(fnId)}
                              style={{
                                padding: "9px 14px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                userSelect: "none",
                                background: isFnExpanded
                                  ? (isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.03)")
                                  : "transparent",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                {isFnExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                <Code2 size={14} style={{ color: isCovered ? "#0284c7" : "#f59e0b" }} />
                                <span
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    fontFamily: "var(--font-mono)",
                                    color: isLight ? "#0f172a" : "#f8fafc",
                                  }}
                                >
                                  {fn.cleanName}()
                                </span>
                                <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e", fontFamily: "var(--font-mono)" }}>
                                  L{fn.startLine || fn.line || 1}
                                  {fn.endLine ? ` - L${fn.endLine}` : ""}
                                </span>

                                {/* 4-Category Scenario Checklist Indicators */}
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 8, flexWrap: "wrap" }}>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 650,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: fn.hasHappyPath ? "rgba(16, 185, 129, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)"),
                                      color: fn.hasHappyPath ? "#10b981" : (isLight ? "#94a3b8" : "#64748b"),
                                      border: fn.hasHappyPath ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid transparent",
                                    }}
                                    title="Category A: Happy Path (Standard valid inputs & expected results)"
                                  >
                                    A. Happy: {fn.hasHappyPath ? "✓" : "—"}
                                  </span>

                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 650,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: fn.hasBoundary ? "rgba(245, 158, 11, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)"),
                                      color: fn.hasBoundary ? "#f59e0b" : (isLight ? "#94a3b8" : "#64748b"),
                                      border: fn.hasBoundary ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid transparent",
                                    }}
                                    title="Category B: Boundary Values (0, -1, MAX limits, empty [], '', null/undefined)"
                                  >
                                    B. Boundary: {fn.hasBoundary ? "✓" : "—"}
                                  </span>

                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 650,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: fn.hasBranch ? "rgba(2, 132, 199, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)"),
                                      color: fn.hasBranch ? "#0284c7" : (isLight ? "#94a3b8" : "#64748b"),
                                      border: fn.hasBranch ? "1px solid rgba(2, 132, 199, 0.3)" : "1px solid transparent",
                                    }}
                                    title="Category C: Branch Toggling (True vs False, conditional fallbacks ??, logical ||)"
                                  >
                                    C. Branch: {fn.hasBranch ? "✓" : "—"}
                                  </span>

                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 650,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: fn.hasError ? "rgba(239, 68, 68, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)"),
                                      color: fn.hasError ? "#ef4444" : (isLight ? "#94a3b8" : "#64748b"),
                                      border: fn.hasError ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid transparent",
                                    }}
                                    title="Category D: Error Handling (Exceptions, throw Error, catch, rejected promises)"
                                  >
                                    D. Error: {fn.hasError ? "✓" : "—"}
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {/* Category Status Pill */}
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    background: fn.tests.length === 0
                                      ? (isLight ? "#fff1f2" : "rgba(239, 68, 68, 0.15)")
                                      : fn.coveredCategoriesCount === 4
                                        ? (isLight ? "#ecfdf5" : "rgba(16, 185, 129, 0.15)")
                                        : (isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.15)"),
                                    color: fn.tests.length === 0
                                      ? (isLight ? "#dc2626" : "#f87171")
                                      : fn.coveredCategoriesCount === 4
                                        ? (isLight ? "#059669" : "#4ade80")
                                        : (isLight ? "#b45309" : "#fbbf24"),
                                    border: fn.tests.length === 0
                                      ? (isLight ? "1px solid #fecdd3" : "1px solid rgba(239, 68, 68, 0.3)")
                                      : fn.coveredCategoriesCount === 4
                                        ? (isLight ? "1px solid #a7f3d0" : "1px solid rgba(16, 185, 129, 0.3)")
                                        : (isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.3)"),
                                  }}
                                >
                                  {fn.tests.length === 0
                                    ? "⚑ 0 tests"
                                    : fn.coveredCategoriesCount === 4
                                      ? `✓ 4/4 Categories (${fn.tests.length} tests)`
                                      : `⚠️ ${fn.coveredCategoriesCount}/4 Categories (${fn.tests.length} tests)`}
                                </span>

                                {/* Suggestion & Test Generation Action Group */}
                                {isSuggesting ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                      padding: "3px 9px",
                                      borderRadius: 5,
                                      background: isLight ? "#f5f3ff" : "rgba(139, 92, 246, 0.15)",
                                      border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(139, 92, 246, 0.3)",
                                      color: isLight ? "#6d28d9" : "#c4b5fd",
                                      fontSize: 11,
                                      fontWeight: 650,
                                    }}
                                  >
                                    <Loader2 size={11} className="animate-spin text-purple-500" />
                                    <span>Generating...</span>
                                  </div>
                                ) : isApplying ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                      padding: "3px 9px",
                                      borderRadius: 5,
                                      background: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.15)",
                                      border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)",
                                      color: isLight ? "#15803d" : "#86efac",
                                      fontSize: 11,
                                      fontWeight: 650,
                                    }}
                                  >
                                    <Loader2 size={11} className="animate-spin text-green-500" />
                                    <span>Applying & Running...</span>
                                  </div>
                                ) : hasPending ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    {onReviewDiff && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onReviewDiff(fn.filePath);
                                        }}
                                        style={{
                                          padding: "3px 8px",
                                          borderRadius: 5,
                                          background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
                                          border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.18)",
                                          color: isLight ? "#1e293b" : "#f1f5f9",
                                          fontSize: 11,
                                          fontWeight: 650,
                                          cursor: "pointer",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 4,
                                          transition: "all 0.15s ease",
                                        }}
                                        className="hover:opacity-90"
                                        title="Review test code diff before applying"
                                      >
                                        <FileDiff size={11} style={{ color: "#6366f1" }} />
                                        <span>Review</span>
                                      </button>
                                    )}
                                    {onApplyAllFileSuggestions && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onApplyAllFileSuggestions(fn.filePath, fileSugs);
                                        }}
                                        style={{
                                          padding: "3px 9px",
                                          borderRadius: 5,
                                          background: "#16a34a",
                                          border: "1px solid #15803d",
                                          color: "#ffffff",
                                          fontSize: 11,
                                          fontWeight: 700,
                                          cursor: "pointer",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 4,
                                          transition: "all 0.15s ease",
                                        }}
                                        className="hover:opacity-90"
                                        title="Apply generated tests for this file"
                                      >
                                        <Zap size={11} />
                                        <span>Apply</span>
                                      </button>
                                    )}
                                  </div>
                                ) : hasPassed ? (
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 700,
                                      color: "#16a34a",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 3,
                                      padding: "2px 6px",
                                      borderRadius: 4,
                                      background: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.12)",
                                    }}
                                  >
                                    <Check size={11} strokeWidth={3} />
                                    <span>Merged</span>
                                  </span>
                                ) : onSuggestTestcase && fn.missingCategories.length > 0 ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSuggestTestcase(fn.filePath);
                                    }}
                                    style={{
                                      padding: "3px 9px",
                                      borderRadius: 5,
                                      background: isLight ? "#eef2ff" : "rgba(99, 102, 241, 0.18)",
                                      border: isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.35)",
                                      color: isLight ? "#4f46e5" : "#a5b4fc",
                                      fontSize: 11,
                                      fontWeight: 650,
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 4,
                                      transition: "all 0.15s ease",
                                    }}
                                    title={`Generate tests for missing categories: ${fn.missingCategories.join(", ")}`}
                                  >
                                    <Sparkles size={11} />
                                    <span>Suggest tests</span>
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {/* ── EXPANDED DECISION TABLE MATRIX & TEST INSPECTOR ── */}
                            {isFnExpanded && (
                              <div
                                style={{
                                  padding: "14px 16px",
                                  borderTop: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.05)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 14,
                                  background: isLight ? "#fbfcfe" : "rgba(0, 0, 0, 0.2)",
                                }}
                              >
                                {/* Header explanation */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <ShieldCheck size={15} style={{ color: "#6366f1" }} />
                                    <span style={{ fontSize: 12, fontWeight: 700, color: isLight ? "#0f172a" : "#f8fafc" }}>
                                      4-Category Decision Table Matrix (How this function is tested)
                                    </span>
                                  </div>
                                  <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8" }}>
                                    Status: <strong style={{ color: fn.coveredCategoriesCount === 4 ? "#10b981" : "#f59e0b" }}>{fn.coveredCategoriesCount} of 4 categories covered</strong> ({fn.tests.length} total tests)
                                  </span>
                                </div>

                                {/* 4-Card Decision Table Matrix Grid */}
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                                    gap: 10,
                                  }}
                                >
                                  {/* Card A: Happy Path */}
                                  <div
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 8,
                                      background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
                                      border: fn.hasHappyPath
                                        ? (isLight ? "1px solid #a7f3d0" : "1px solid rgba(16, 185, 129, 0.3)")
                                        : (isLight ? "1px dashed #cbd5e1" : "1px dashed rgba(255, 255, 255, 0.15)"),
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                      <span style={{ fontSize: 11.5, fontWeight: 750, color: "#10b981" }}>
                                        🟢 A. Happy Path
                                      </span>
                                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: fn.hasHappyPath ? "rgba(16, 185, 129, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255,255,255,0.05)"), color: fn.hasHappyPath ? "#10b981" : "#94a3b8" }}>
                                        {fn.hasHappyPath ? `${fn.testsByCategory.HAPPY_PATH.length} tests` : "Missing"}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 10.5, color: isLight ? "#64748b" : "#8b949e", lineHeight: 1.4 }}>
                                      Verifies standard valid inputs, normal workflow, and expected return values.
                                    </div>
                                    {fn.hasHappyPath ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                                        {fn.testsByCategory.HAPPY_PATH.map((t, idx) => (
                                          <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, padding: "3px 6px", background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)", borderRadius: 4 }}>
                                            <span style={{ fontFamily: "var(--font-mono)", color: isLight ? "#1e293b" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }} title={t.title}>
                                              {t.status === "passed" ? "✓" : "✗"} {t.title}
                                            </span>
                                            <button onClick={() => onOpenFile?.(t.suiteFilePath)} style={{ background: "transparent", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 10.5, display: "flex", alignItems: "center", gap: 2 }}>
                                              <span>{t.suiteFileName}</span>
                                              <ExternalLink size={9} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 10.5, color: isLight ? "#b45309" : "#fbbf24", background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.08)", padding: "4px 8px", borderRadius: 4, marginTop: 4 }}>
                                        ⚠️ Uncovered: No test verifies standard execution flow with valid arguments.
                                      </div>
                                    )}
                                  </div>

                                  {/* Card B: Boundary Values */}
                                  <div
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 8,
                                      background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
                                      border: fn.hasBoundary
                                        ? (isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.3)")
                                        : (isLight ? "1px dashed #cbd5e1" : "1px dashed rgba(255, 255, 255, 0.15)"),
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                      <span style={{ fontSize: 11.5, fontWeight: 750, color: "#f59e0b" }}>
                                        🟡 B. Boundary Values
                                      </span>
                                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: fn.hasBoundary ? "rgba(245, 158, 11, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255,255,255,0.05)"), color: fn.hasBoundary ? "#f59e0b" : "#94a3b8" }}>
                                        {fn.hasBoundary ? `${fn.testsByCategory.BOUNDARY_VALUES.length} tests` : "Missing"}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 10.5, color: isLight ? "#64748b" : "#8b949e", lineHeight: 1.4 }}>
                                      Verifies boundary limits (0, -1, MAX values, empty arrays [], empty strings, null/undefined).
                                    </div>
                                    {fn.hasBoundary ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                                        {fn.testsByCategory.BOUNDARY_VALUES.map((t, idx) => (
                                          <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, padding: "3px 6px", background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)", borderRadius: 4 }}>
                                            <span style={{ fontFamily: "var(--font-mono)", color: isLight ? "#1e293b" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }} title={t.title}>
                                              {t.status === "passed" ? "✓" : "✗"} {t.title}
                                            </span>
                                            <button onClick={() => onOpenFile?.(t.suiteFilePath)} style={{ background: "transparent", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 10.5, display: "flex", alignItems: "center", gap: 2 }}>
                                              <span>{t.suiteFileName}</span>
                                              <ExternalLink size={9} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 10.5, color: isLight ? "#b45309" : "#fbbf24", background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.08)", padding: "4px 8px", borderRadius: 4, marginTop: 4 }}>
                                        ⚠️ Uncovered: Edge cases like empty inputs, zero, or max limits are not yet tested.
                                      </div>
                                    )}
                                  </div>

                                  {/* Card C: Branch Toggling */}
                                  <div
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 8,
                                      background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
                                      border: fn.hasBranch
                                        ? (isLight ? "1px solid #bae6fd" : "1px solid rgba(2, 132, 199, 0.3)")
                                        : (isLight ? "1px dashed #cbd5e1" : "1px dashed rgba(255, 255, 255, 0.15)"),
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                      <span style={{ fontSize: 11.5, fontWeight: 750, color: "#0284c7" }}>
                                        🔵 C. Branch Toggling
                                      </span>
                                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: fn.hasBranch ? "rgba(2, 132, 199, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255,255,255,0.05)"), color: fn.hasBranch ? "#0284c7" : "#94a3b8" }}>
                                        {fn.hasBranch ? `${fn.testsByCategory.BRANCH_TOGGLING.length} tests` : "Missing"}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 10.5, color: isLight ? "#64748b" : "#8b949e", lineHeight: 1.4 }}>
                                      Verifies conditional branches (True vs False paths, fallback ??, logical || operators).
                                    </div>
                                    {fn.hasBranch ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                                        {fn.testsByCategory.BRANCH_TOGGLING.map((t, idx) => (
                                          <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, padding: "3px 6px", background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)", borderRadius: 4 }}>
                                            <span style={{ fontFamily: "var(--font-mono)", color: isLight ? "#1e293b" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }} title={t.title}>
                                              {t.status === "passed" ? "✓" : "✗"} {t.title}
                                            </span>
                                            <button onClick={() => onOpenFile?.(t.suiteFilePath)} style={{ background: "transparent", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 10.5, display: "flex", alignItems: "center", gap: 2 }}>
                                              <span>{t.suiteFileName}</span>
                                              <ExternalLink size={9} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 10.5, color: isLight ? "#b45309" : "#fbbf24", background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.08)", padding: "4px 8px", borderRadius: 4, marginTop: 4 }}>
                                        ⚠️ Uncovered: Missing tests for alternate condition branches or fallback logic.
                                      </div>
                                    )}
                                  </div>

                                  {/* Card D: Error & Exception Handling */}
                                  <div
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 8,
                                      background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
                                      border: fn.hasError
                                        ? (isLight ? "1px solid #fecdd3" : "1px solid rgba(239, 68, 68, 0.3)")
                                        : (isLight ? "1px dashed #cbd5e1" : "1px dashed rgba(255, 255, 255, 0.15)"),
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                      <span style={{ fontSize: 11.5, fontWeight: 750, color: "#ef4444" }}>
                                        🔴 D. Error Handling
                                      </span>
                                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: fn.hasError ? "rgba(239, 68, 68, 0.15)" : (isLight ? "#f1f5f9" : "rgba(255,255,255,0.05)"), color: fn.hasError ? "#ef4444" : "#94a3b8" }}>
                                        {fn.hasError ? `${fn.testsByCategory.ERROR_HANDLING.length} tests` : "Missing"}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 10.5, color: isLight ? "#64748b" : "#8b949e", lineHeight: 1.4 }}>
                                      Verifies thrown exceptions (throw Error), catch blocks, rejected promises, mock failures.
                                    </div>
                                    {fn.hasError ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                                        {fn.testsByCategory.ERROR_HANDLING.map((t, idx) => (
                                          <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, padding: "3px 6px", background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)", borderRadius: 4 }}>
                                            <span style={{ fontFamily: "var(--font-mono)", color: isLight ? "#1e293b" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }} title={t.title}>
                                              {t.status === "passed" ? "✓" : "✗"} {t.title}
                                            </span>
                                            <button onClick={() => onOpenFile?.(t.suiteFilePath)} style={{ background: "transparent", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 10.5, display: "flex", alignItems: "center", gap: 2 }}>
                                              <span>{t.suiteFileName}</span>
                                              <ExternalLink size={9} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 10.5, color: isLight ? "#b45309" : "#fbbf24", background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.08)", padding: "4px 8px", borderRadius: 4, marginTop: 4 }}>
                                        ⚠️ Uncovered: No test verifies exception throwing or error handling.
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Guidance & Suggest Action Footer */}
                                {fn.missingCategories.length > 0 ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <div
                                      style={{
                                        padding: "8px 12px",
                                        borderRadius: 6,
                                        background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.08)",
                                        border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.25)",
                                        fontSize: 11.5,
                                        color: isLight ? "#92400e" : "#fde68a",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        flexWrap: "wrap",
                                        gap: 8,
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ fontWeight: 700 }}>💡 Missing Coverage Gaps:</span>
                                        <span>Missing categories: {fn.missingCategories.join(", ")}</span>
                                      </div>

                                      {hasPending ? (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                          <span style={{ fontSize: 11.5, fontWeight: 700, color: isLight ? "#15803d" : "#4ade80" }}>
                                            ✨ {fileSugs.length} test proposal ready
                                          </span>
                                          {onReviewDiff && (
                                            <button
                                              onClick={() => onReviewDiff(fn.filePath)}
                                              style={{
                                                padding: "3px 10px",
                                                borderRadius: 5,
                                                background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.08)",
                                                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.2)",
                                                color: isLight ? "#1e293b" : "#f1f5f9",
                                                fontSize: 11,
                                                fontWeight: 650,
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 4,
                                              }}
                                              className="hover:opacity-90"
                                              title="Inspect side-by-side Monaco diff"
                                            >
                                              <FileDiff size={12} style={{ color: "#6366f1" }} />
                                              <span>Review Diff</span>
                                            </button>
                                          )}
                                          {onApplyAllFileSuggestions && (
                                            <button
                                              onClick={() => onApplyAllFileSuggestions(fn.filePath, fileSugs)}
                                              disabled={isApplying}
                                              style={{
                                                padding: "3px 12px",
                                                borderRadius: 5,
                                                background: "#16a34a",
                                                border: "1px solid #15803d",
                                                color: "#ffffff",
                                                fontSize: 11,
                                                fontWeight: 700,
                                                cursor: isApplying ? "wait" : "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 5,
                                              }}
                                              className="hover:opacity-90"
                                              title="Safely merge tests into suite and run verification"
                                            >
                                              {isApplying ? (
                                                <>
                                                  <Loader2 size={12} className="animate-spin" />
                                                  <span>Applying & Verifying...</span>
                                                </>
                                              ) : (
                                                <>
                                                  <Zap size={12} />
                                                  <span>Apply Tests</span>
                                                </>
                                              )}
                                            </button>
                                          )}
                                        </div>
                                      ) : (
                                        onSuggestTestcase && (
                                          <button
                                            onClick={() => onSuggestTestcase(fn.filePath)}
                                            disabled={isSuggesting}
                                            style={{
                                              padding: "3px 10px",
                                              borderRadius: 5,
                                              background: isSuggesting
                                                ? (isLight ? "#fef3c7" : "rgba(245, 158, 11, 0.2)")
                                                : "#f59e0b",
                                              border: "1px solid #d97706",
                                              color: "#ffffff",
                                              fontSize: 11,
                                              fontWeight: 700,
                                              cursor: isSuggesting ? "wait" : "pointer",
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 4,
                                            }}
                                          >
                                            {isSuggesting ? (
                                              <>
                                                <Loader2 size={11} className="animate-spin" />
                                                <span>Generating tests...</span>
                                              </>
                                            ) : (
                                              <>
                                                <Sparkles size={11} />
                                                <span>Suggest Tests for Missing Scenarios</span>
                                              </>
                                            )}
                                          </button>
                                        )
                                      )}
                                    </div>

                                    {/* Test Execution Failure Diagnostic Notice */}
                                    {hasFailed && (
                                      <div
                                        style={{
                                          padding: "8px 12px",
                                          borderRadius: 6,
                                          background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.12)",
                                          border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.35)",
                                          color: isLight ? "#991b1b" : "#fca5a5",
                                          fontSize: 11,
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          gap: 8,
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                          <AlertCircle size={13} style={{ color: "#ef4444", flexShrink: 0 }} />
                                          <span>
                                            <b>Test Runner Error:</b> {fileSugs.find(s => s.testRunError)?.testRunError || "Tests executed with failures. Click Review Diff to inspect or click Retry."}
                                          </span>
                                        </div>
                                        {onApplyAllFileSuggestions && (
                                          <button
                                            onClick={() => onApplyAllFileSuggestions(fn.filePath, fileSugs)}
                                            style={{
                                              padding: "2px 8px",
                                              borderRadius: 4,
                                              background: "#ef4444",
                                              color: "#ffffff",
                                              border: "none",
                                              cursor: "pointer",
                                              fontSize: 10.5,
                                              fontWeight: 700,
                                            }}
                                          >
                                            Retry
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      borderRadius: 6,
                                      background: isLight ? "#ecfdf5" : "rgba(16, 185, 129, 0.08)",
                                      border: isLight ? "1px solid #a7f3d0" : "1px solid rgba(16, 185, 129, 0.25)",
                                      fontSize: 11.5,
                                      color: isLight ? "#065f46" : "#6ee7b7",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <CheckCircle2 size={14} style={{ color: "#10b981", flexShrink: 0 }} />
                                    <span>
                                      <strong>100% Robust Coverage:</strong> This function is exercised across all 4 decision table categories (Happy Path, Boundary Values, Branch Toggling, Error Handling).
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
