import React, { useState, useMemo, useRef, useEffect } from "react";
import IntegrationScenarioEditorModal, { getScenarioMonacoMarkers } from "./IntegrationScenarioEditorModal.jsx";
import ConfirmDialog from "../../common/ConfirmDialog";
import { matchScenarioFuzzy } from "../../../utils/fuzzySearch";
import {
  Plus,
  Trash2,
  Power,
  RefreshCw,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Search,
  Sparkles,
  Folder,
  FolderOpen,
  Filter,
  X,
  Layers,
  HardDriveDownload,
} from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

const METHOD_STYLES = {
  GET: "bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20",
  POST: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  PUT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PATCH: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  DELETE: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const METHOD_ORDER = {
  GET: 1,
  POST: 2,
  PUT: 3,
  PATCH: 4,
  DELETE: 5,
};

export function getEndpointModule(path) {
  if (!path) return "GENERAL";
  const segments = path.split("/").filter(Boolean);
  let idx = 0;
  while (idx < segments.length && /^(api|v\d+)$/i.test(segments[idx])) {
    idx++;
  }
  if (idx < segments.length) {
    const seg = segments[idx].replace(/^:/, "").toUpperCase();
    return seg || "ROOT";
  }
  return "ROOT";
}

export function getScenarioClassification(scenario) {
  if (!scenario.enabled) {
    return {
      priority: 99,
      category: "disabled",
      label: "Disabled",
      badgeStyle: "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]",
    };
  }

  const text = `${scenario.testName || ""} ${scenario.description || ""} ${scenario.expectedStatus || ""}`.toLowerCase();

  // 1. P3: Server Resiliency (500, 502, 503, internal server error, crash, timeout)
  if (
    /\b(500|502|503)\b/.test(text) ||
    text.includes("internal server error") ||
    text.includes("server error") ||
    text.includes("crash") ||
    text.includes("timeout") ||
    text.includes("resiliency")
  ) {
    return {
      priority: 5,
      category: "resiliency",
      label: "P3 • Resiliency",
      badgeStyle: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    };
  }

  // 2. P2: Resource & Edge Case: 404 Not Found, 409 Conflict, Duplicate
  if (
    /\b(404|409)\b/.test(text) ||
    text.includes("not found") ||
    text.includes("conflict") ||
    text.includes("duplicate")
  ) {
    return {
      priority: 4,
      category: "edge_case",
      label: "P2 • Edge Case",
      badgeStyle: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    };
  }

  // 3. P1: Security & Auth (401, 403, auth, token, unauthorized, forbidden, permissions)
  if (
    /\b(401|403)\b/.test(text) ||
    text.includes("auth") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("token") ||
    text.includes("permission")
  ) {
    return {
      priority: 2,
      category: "security",
      label: "P1 • Security",
      badgeStyle: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    };
  }

  // 4. P1: Data Validation (400, 422, validation, invalid, missing, malformed, bad request, required, or error)
  if (
    /\b(400|422)\b/.test(text) ||
    text.includes("validation") ||
    text.includes("missing") ||
    text.includes("invalid") ||
    text.includes("required") ||
    text.includes("malformed") ||
    text.includes("bad request") ||
    (text.includes("error") && !text.includes("happy path"))
  ) {
    return {
      priority: 3,
      category: "validation",
      label: "P1 • Validation",
      badgeStyle: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    };
  }

  // 5. P2: Other Edge Cases (query, pagination, empty, boundary)
  if (
    text.includes("edge case") ||
    text.includes("query") ||
    text.includes("pagination") ||
    text.includes("empty") ||
    text.includes("boundary")
  ) {
    return {
      priority: 4,
      category: "edge_case",
      label: "P2 • Edge Case",
      badgeStyle: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    };
  }

  // 6. P0: Happy Path (happy path, 200, 201, success, successfully)
  if (
    text.includes("happy path") ||
    /\b(200|201)\b/.test(text) ||
    text.includes("successfully") ||
    text.includes("success")
  ) {
    return {
      priority: 1,
      category: "happy_path",
      label: "P0 • Happy Path",
      badgeStyle: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    };
  }

  // Default fallback scenario
  return {
    priority: 10,
    category: "other",
    label: "P2 • Scenario",
    badgeStyle: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  };
}

export function getScenarioOrigin(scenario) {
  if (scenario.origin === "USER_ADDED") {
    return {
      type: "USER_ADDED",
      badge: "A",
      label: "User Added",
      badgeStyle: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      tooltip: "User Added • Custom scenario created manually",
    };
  }
  if (scenario.origin === "USER_MODIFIED" || scenario.userEdited) {
    const origInfo = scenario.originalTestName ? ` (Original: ${scenario.originalTestName})` : "";
    return {
      type: "USER_MODIFIED",
      badge: "M",
      label: "User Modified",
      badgeStyle: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
      tooltip: `User Modified • Scenario code modified by user${origInfo}`,
    };
  }
  return {
    type: "AI_GENERATED",
    badge: "AI",
    label: "CovAI Baseline",
    badgeStyle: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    tooltip: "CovAI Baseline • Generated automatically during initial AI analysis",
  };
}

function IndeterminateCheckbox({ checked, indeterminate, onChange, disabled, className, title }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate) && !checked;
    }
  }, [checked, indeterminate]);

  return (
    <input
      type="checkbox"
      ref={ref}
      checked={Boolean(checked)}
      onChange={onChange}
      disabled={disabled}
      className={className}
      title={title}
    />
  );
}

export default function IntegrationScenariosPane({
  aiTests = [],
  selectedEndpoint,
  onClearSelectedEndpoint,
  hasGeneratedTests,
  hasAnalysis = true,
  onRunAnalysis,
  isApproved,
  selectedTestIds = [],
  setSelectedTestIds,
  snapshotId,
  endpoints = [],
  onOpenCFG,
  onSuggestTestcase,
  onOpenArchitecture,
  onScenarioChange,
  onError,
  onGenerateThisEndpoint,
  isGenerating = false,
  onApproveAndRun,
  isApprovingAndRunning = false,
  onReGenerateSelected,
  onOpenApplyModal,
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCode, setEditorCode] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);

  // Edit & Add scenario state
  const [editingScenario, setEditingScenario] = useState(null);
  const [addingToEndpoint, setAddingToEndpoint] = useState(null);
  const [processingScenarioId, setProcessingScenarioId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeMenuScenarioId, setActiveMenuScenarioId] = useState(null);

  // Scalability state: Collapse sets, search text, active filter pill
  const [collapsedModules, setCollapsedModules] = useState(new Set());
  const [collapsedEndpoints, setCollapsedEndpoints] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTypeFilter, setActiveTypeFilter] = useState("ALL"); // ALL, HAPPY_PATH, VALIDATION, CUSTOM, DISABLED
  const [showRegenerateAllConfirm, setShowRegenerateAllConfirm] = useState(false);
  const [generatingEndpointKey, setGeneratingEndpointKey] = useState(null);

  useEffect(() => {
    if (!isGenerating) {
      setGeneratingEndpointKey(null);
    }
  }, [isGenerating]);

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest("[data-context-menu]")) {
        setActiveMenuScenarioId(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const toggleModuleCollapse = (moduleName) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleName)) next.delete(moduleName);
      else next.add(moduleName);
      return next;
    });
  };

  const toggleEndpointCollapse = (key) => {
    setCollapsedEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Match executed request URL back to declared API endpoint
  const findMatchingEndpoint = (method, reqPath) => {
    if (!endpoints || endpoints.length === 0) return null;
    const cleanReq = (reqPath || "").split("?")[0].replace(/\/+$/, "") || "/";
    const reqMethod = (method || "").toUpperCase();

    for (const ep of endpoints) {
      if ((ep.method || "").toUpperCase() !== reqMethod) continue;
      const cleanRoute = (ep.path || ep.route || ep.fullPath || "").replace(/\/+$/, "") || "/";
      const regexStr = "^" + cleanRoute.replace(/\./g, "\\.").replace(/:[a-zA-Z0-9_]+/g, "[^/]+") + "$";
      if (new RegExp(regexStr, "i").test(cleanReq)) {
        return ep;
      }
    }
    return null;
  };

  // Group tests by endpoint & Sort scenarios inside each endpoint by priority matrix
  const scenariosByEndpoint = useMemo(() => {
    const map = {};
    (aiTests || []).forEach((t) => {
      if (!t) return;
      (t.requests || []).forEach((r, idx) => {
        if (!r) return;
        const rMethod = (r.method || "GET").toUpperCase();
        const rPath = r.path || "";
        const matchedEp = findMatchingEndpoint(rMethod, rPath);
        const epMethod = matchedEp ? (matchedEp.method || "GET").toUpperCase() : rMethod;
        const epPath = matchedEp
          ? (matchedEp.path || matchedEp.route || matchedEp.fullPath || "/")
          : rPath.split("?")[0] || "/";
        const epKey = `${epMethod} ${epPath}`;

        if (!map[epKey]) {
          map[epKey] = {
            method: epMethod,
            path: epPath,
            module: getEndpointModule(epPath),
            isValid: t.isValid,
            filePath: t.filePath,
            scenarios: [],
            testFileId: t.id,
            fileStatus: t.status,
          };
        }
        map[epKey].scenarios.push({
          ...r,
          id: `${t.id}::${r.scenarioId || r.testName || idx}`,
          testName: r.testName || `Scenario ${idx + 1}`,
          enabled: r.enabled !== false,
          userEdited: Boolean(r.userEdited),
        });
      });
    });

    // Level 3: Sort scenarios inside each endpoint according to the priority matrix
    Object.values(map).forEach((ep) => {
      ep.scenarios.sort((a, b) => {
        const classA = getScenarioClassification(a);
        const classB = getScenarioClassification(b);
        if (classA.priority !== classB.priority) {
          return classA.priority - classB.priority;
        }
        return (a.testName || "").localeCompare(b.testName || "");
      });
    });

    return map;
  }, [aiTests, endpoints]);

  // Level 1: Group endpoints by Module
  const modulesData = useMemo(() => {
    const moduleMap = {};

    Object.keys(scenariosByEndpoint).forEach((key) => {
      const epData = scenariosByEndpoint[key];
      const mod = epData.module || "GENERAL";
      if (!moduleMap[mod]) {
        moduleMap[mod] = {
          name: mod,
          endpoints: [],
        };
      }
      moduleMap[mod].endpoints.push(epData);
    });

    // Level 2: Sort endpoints within each module by path, then by HTTP method order
    Object.values(moduleMap).forEach((mod) => {
      mod.endpoints.sort((a, b) => {
        const pathCmp = a.path.localeCompare(b.path);
        if (pathCmp !== 0) return pathCmp;
        return (METHOD_ORDER[a.method] || 99) - (METHOD_ORDER[b.method] || 99);
      });
    });

    // Sort modules alphabetically with ROOT/GENERAL at the end
    return Object.values(moduleMap).sort((a, b) => {
      if (a.name === "ROOT" || a.name === "GENERAL") return 1;
      if (b.name === "ROOT" || b.name === "GENERAL") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [scenariosByEndpoint]);

  // Global counts for filter pills across all scenarios
  const filterCounts = useMemo(() => {
    let all = 0;
    let ai = 0;
    let added = 0;
    let modified = 0;
    let happy = 0;
    let validation = 0;
    let disabled = 0;

    Object.values(scenariosByEndpoint).forEach((ep) => {
      (ep.scenarios || []).forEach((s) => {
        all++;
        const origin = getScenarioOrigin(s);
        if (origin.type === "USER_ADDED") added++;
        else if (origin.type === "USER_MODIFIED") modified++;
        else ai++;

        const c = getScenarioClassification(s);
        if (c.category === "happy_path") happy++;
        if (["security", "validation", "edge_case", "resiliency"].includes(c.category)) validation++;
        if (!s.enabled) disabled++;
      });
    });

    return { all, ai, added, modified, happy, validation, disabled };
  }, [scenariosByEndpoint]);

  // Search & Filter predicate
  const matchesFilter = (scenario, epData) => {
    const classification = getScenarioClassification(scenario);
    const origin = getScenarioOrigin(scenario);

    if (activeTypeFilter === "AI" && origin.type !== "AI_GENERATED") {
      return false;
    }
    if (activeTypeFilter === "ADDED" && origin.type !== "USER_ADDED") {
      return false;
    }
    if (activeTypeFilter === "MODIFIED" && origin.type !== "USER_MODIFIED") {
      return false;
    }
    if (activeTypeFilter === "HAPPY_PATH" && classification.category !== "happy_path") {
      return false;
    }
    if (
      activeTypeFilter === "VALIDATION" &&
      !["security", "validation", "edge_case", "resiliency"].includes(classification.category)
    ) {
      return false;
    }
    if (activeTypeFilter === "DISABLED" && scenario.enabled) {
      return false;
    }

    if (searchQuery.trim()) {
      const fuzzyRes = matchScenarioFuzzy(
        {
          ...scenario,
          classificationLabel: classification.label,
        },
        epData,
        searchQuery
      );
      if (!fuzzyRes.match) {
        return false;
      }
    }

    return true;
  };

  // Filtered 3-tier structure
  const filteredModules = useMemo(() => {
    return modulesData
      .map((mod) => {
        const endpointsInMod = mod.endpoints
          .filter((ep) => {
            if (selectedEndpoint) {
              const selKey = `${selectedEndpoint.method} ${selectedEndpoint.path || selectedEndpoint.route}`;
              const epKey = `${ep.method} ${ep.path}`;
              if (selKey !== epKey) return false;
            }
            return true;
          })
          .map((ep) => {
            const matchingScenarios = ep.scenarios.filter((s) => matchesFilter(s, ep));
            return {
              ...ep,
              filteredScenarios: matchingScenarios,
            };
          })
          .filter((ep) => ep.filteredScenarios.length > 0 || (!searchQuery.trim() && activeTypeFilter === "ALL" && selectedEndpoint));

        return {
          ...mod,
          endpoints: endpointsInMod,
        };
      })
      .filter((mod) => mod.endpoints.length > 0);
  }, [modulesData, selectedEndpoint, searchQuery, activeTypeFilter]);

  // Scenarios visible and enabled (for master selection)
  const visibleEnabledScenarios = useMemo(() => {
    const list = [];
    filteredModules.forEach((mod) => {
      mod.endpoints.forEach((ep) => {
        (ep.filteredScenarios || []).forEach((s) => {
          if (s.enabled) {
            list.push(s.id);
          }
        });
      });
    });
    return list;
  }, [filteredModules]);

  const visibleSelectedIds = useMemo(() => {
    return visibleEnabledScenarios.filter((id) => selectedTestIds.includes(id));
  }, [visibleEnabledScenarios, selectedTestIds]);

  const selectedCount = visibleSelectedIds.length;
  const isAllMasterSelected = visibleEnabledScenarios.length > 0 && selectedCount === visibleEnabledScenarios.length;
  const isMasterIndeterminate = selectedCount > 0 && selectedCount < visibleEnabledScenarios.length;

  const reGenerateInfo = useMemo(() => {
    if (selectedEndpoint) {
      const epKey = `${selectedEndpoint.method} ${selectedEndpoint.path || selectedEndpoint.route}`;
      return {
        type: "SINGLE_ENDPOINT",
        label: `Re-Generate (${selectedEndpoint.method})`,
        targets: [epKey],
        tooltip: `Re-generate scenarios for ${epKey}`,
      };
    }

    if (selectedTestIds && selectedTestIds.length > 0) {
      const targetEpSet = new Set();
      Object.values(scenariosByEndpoint).forEach((ep) => {
        const hasSelected = (ep.scenarios || []).some((s) => selectedTestIds.includes(s.id));
        if (hasSelected) {
          targetEpSet.add(`${ep.method} ${ep.path}`);
        }
      });
      const targetList = Array.from(targetEpSet);
      if (targetList.length > 0 && targetList.length < Object.keys(scenariosByEndpoint).length) {
        return {
          type: "SELECTED_ENDPOINTS",
          label: `Re-Generate (${targetList.length} APIs)`,
          targets: targetList,
          tooltip: `Re-generate scenarios for ${targetList.length} endpoints with selected tests`,
        };
      }
    }

    const allCount = Object.keys(scenariosByEndpoint).length;
    return {
      type: "ALL",
      label: "Re-Generate All",
      targets: null,
      tooltip: `Re-generate test scenarios for all ${allCount} endpoints`,
    };
  }, [selectedEndpoint, selectedTestIds, scenariosByEndpoint]);

  const handleHeaderReGenerate = () => {
    if (!onReGenerateSelected) return;
    if (reGenerateInfo.type === "ALL") {
      setShowRegenerateAllConfirm(true);
    } else {
      onReGenerateSelected(reGenerateInfo.targets);
    }
  };

  const handleToggleMaster = () => {
    if (isAllMasterSelected) {
      setSelectedTestIds((prev) => prev.filter((id) => !visibleEnabledScenarios.includes(id)));
    } else {
      setSelectedTestIds((prev) => {
        const next = new Set(prev);
        visibleEnabledScenarios.forEach((id) => next.add(id));
        return Array.from(next);
      });
    }
  };

  const handleToggleModule = (mod, e) => {
    e.stopPropagation();
    const modEnabledIds = [];
    mod.endpoints.forEach((ep) => {
      (ep.filteredScenarios || []).forEach((s) => {
        if (s.enabled) modEnabledIds.push(s.id);
      });
    });

    const isAllModSelected = modEnabledIds.length > 0 && modEnabledIds.every((id) => selectedTestIds.includes(id));

    if (isAllModSelected) {
      setSelectedTestIds((prev) => prev.filter((id) => !modEnabledIds.includes(id)));
    } else {
      setSelectedTestIds((prev) => {
        const next = new Set(prev);
        modEnabledIds.forEach((id) => next.add(id));
        return Array.from(next);
      });
    }
  };

  const handleToggleEndpoint = (ep, e) => {
    e.stopPropagation();
    const epEnabledIds = (ep.filteredScenarios || []).filter((s) => s.enabled).map((s) => s.id);
    const isAllEpSelected = epEnabledIds.length > 0 && epEnabledIds.every((id) => selectedTestIds.includes(id));

    if (isAllEpSelected) {
      setSelectedTestIds((prev) => prev.filter((id) => !epEnabledIds.includes(id)));
    } else {
      setSelectedTestIds((prev) => {
        const next = new Set(prev);
        epEnabledIds.forEach((id) => next.add(id));
        return Array.from(next);
      });
    }
  };

  const handleExpandAll = () => {
    setCollapsedModules(new Set());
    setCollapsedEndpoints(new Set());
  };

  const handleCollapseAll = () => {
    const allModNames = new Set(modulesData.map((m) => m.name));
    setCollapsedModules(allModNames);
  };

  const handleAction = async (action, scenario) => {
    if (processingScenarioId) return;
    setProcessingScenarioId(scenario.id);
    setActiveMenuScenarioId(null);

    try {
      const parts = scenario.id.split("::");
      const aiTestId = parts[0];
      const scenarioId = encodeURIComponent(parts.slice(1).join("::"));

      let url = `${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${aiTestId}/scenario/${scenarioId}`;
      let method = "POST";
      let body = {};

      if (action === "DELETE") {
        method = "DELETE";
        setSelectedTestIds((prev) => prev.filter((id) => id !== scenario.id));
      } else if (action === "TOGGLE") {
        url += "/toggle";
        method = "PATCH";
        body = { enable: !scenario.enabled };
        if (scenario.enabled) {
          setSelectedTestIds((prev) => prev.filter((id) => id !== scenario.id));
        }
      } else if (action === "REGENERATE") {
        url += "/regenerate";
      }

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: method !== "DELETE" ? JSON.stringify(body) : undefined,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Action failed");

      if (result.jobId) {
        while (true) {
          await new Promise((r) => setTimeout(r, 1500));
          const jobRes = await fetch(`${BASE_URL}/job/${result.jobId}`, {
            headers: getAuthHeaders(),
          });
          if (!jobRes.ok) break;
          const jobData = await jobRes.json();
          const job = jobData.job || jobData.data;
          if (!job) break;
          if (job.status === "SUCCESS") {
            break;
          }
          if (job.status === "FAILED" || job.status === "CANCELED") {
            throw new Error(job.errorMessage || "Regeneration failed");
          }
        }
      }

      if (onScenarioChange) await onScenarioChange();
    } catch (err) {
      console.error("[handleAction] Error:", err);
      if (onError) onError(err.message || "Action failed");
    } finally {
      setProcessingScenarioId(null);
    }
  };

  const handleAddClick = (data) => {
    setAddingToEndpoint({
      aiTestId: data.testFileId,
      endpoint: { method: data.method, path: data.path },
    });
    setEditingScenario(null);
    setEditorTitle(`Add Scenario: ${data.method} ${data.path}`);
    setEditorCode("");
    setEditorOpen(true);
  };

  const availableTargetEndpoints = useMemo(() => {
    if (endpoints && endpoints.length > 0) {
      return endpoints.map((ep) => {
        const key = `${ep.method} ${ep.path || ep.route}`;
        const data = scenariosByEndpoint[key];
        return {
          method: ep.method,
          path: ep.path || ep.route,
          testFileId: data?.testFileId || aiTests[0]?.id,
        };
      });
    }
    return Object.values(scenariosByEndpoint).map((d) => ({
      method: d.method,
      path: d.path,
      testFileId: d.testFileId,
    }));
  }, [endpoints, scenariosByEndpoint, aiTests]);

  const handleTopAddClick = () => {
    let targetData = null;
    if (selectedEndpoint) {
      const key = `${selectedEndpoint.method} ${selectedEndpoint.path || selectedEndpoint.route}`;
      targetData = scenariosByEndpoint[key];
      if (!targetData) {
        targetData = {
          testFileId: aiTests[0]?.id,
          method: selectedEndpoint.method,
          path: selectedEndpoint.path || selectedEndpoint.route,
        };
      }
    } else if (availableTargetEndpoints.length > 0) {
      const first = availableTargetEndpoints[0];
      targetData = scenariosByEndpoint[`${first.method} ${first.path}`] || {
        testFileId: first.testFileId,
        method: first.method,
        path: first.path,
      };
    }

    if (targetData) {
      handleAddClick(targetData);
    }
  };

  const existingTitlesForEndpoint = useMemo(() => {
    const targetEp = addingToEndpoint?.endpoint;
    if (!targetEp) return [];
    const epKey = `${targetEp.method} ${targetEp.path}`;
    const epData = scenariosByEndpoint[epKey];
    return (epData?.scenarios || []).map((s) => s.testName);
  }, [addingToEndpoint, scenariosByEndpoint]);

  const handleOpenEditorForScenario = (scenario) => {
    const parts = scenario.id.split("::");
    const aiTestId = parts[0];
    const scenarioId = parts.slice(1).join("::");
    fetch(
      `${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${aiTestId}/scenario/${encodeURIComponent(scenarioId)}`,
      { headers: getAuthHeaders() },
    )
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setEditingScenario({ aiTestId, scenarioId });
          setAddingToEndpoint(null);
          setEditorTitle(`Edit Scenario: ${scenario.testName}`);
          setEditorCode(res.data.code);
          setEditorOpen(true);
        }
      })
      .catch((err) => {
        if (onError) onError(err.message);
      });
  };

  const handleSaveEditor = async (code) => {
    setEditorLoading(true);
    try {
      if (addingToEndpoint) {
        const res = await fetch(
          `${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${addingToEndpoint.aiTestId}/scenario`,
          {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              code,
              endpoint: addingToEndpoint.endpoint,
            }),
          },
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.message);
      } else if (editingScenario) {
        const scenarioId = encodeURIComponent(editingScenario.scenarioId);
        const res = await fetch(
          `${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${editingScenario.aiTestId}/scenario/${scenarioId}`,
          {
            method: "PUT",
            headers: getAuthHeaders(),
            body: JSON.stringify({ code }),
          },
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.message);
      }

      setEditorOpen(false);
      if (onScenarioChange) await onScenarioChange();
    } catch (err) {
      if (onError) onError(err.message);
    } finally {
      setEditorLoading(false);
    }
  };

  if (!hasAnalysis) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-secondary)] font-sans">
        <div className="w-12 h-12 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center mb-1">
          <Search size={22} />
        </div>
        <div className="text-xs max-w-md">
          <p className="font-semibold text-sm text-[var(--color-text)] mb-1">
            API Analysis Required
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4">
            CovAI needs to discover project endpoints before generating integration test scenarios.
          </p>
          {onRunAnalysis && (
            <button
              type="button"
              onClick={onRunAnalysis}
              className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-2 shadow-sm"
            >
              <Search size={14} />
              <span>Analyze Project</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!hasGeneratedTests) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-secondary)] font-sans">
        <div className="w-12 h-12 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center mb-1">
          <Sparkles size={22} />
        </div>
        <div className="text-xs max-w-md">
          <p className="font-semibold text-sm text-[var(--color-text)] mb-1">
            No test scenarios have been generated yet
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4">
            CovAI analyzes your endpoint controllers, generates boundary conditions and valid request payloads, and creates runnable Supertest suites.
          </p>
          {onReGenerateSelected && (
            <button
              type="button"
              onClick={onReGenerateSelected}
              disabled={isGenerating}
              className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              <Sparkles size={14} />
              <span>{isGenerating ? "Generating Scenarios..." : "Generate Test Scenarios"}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 font-sans text-[var(--color-text)] overflow-hidden bg-[var(--color-surface)]">
      {/* 1. Header with Master Review Toolbar */}
      <div className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <IndeterminateCheckbox
              checked={isAllMasterSelected}
              indeterminate={isMasterIndeterminate}
              onChange={handleToggleMaster}
              disabled={visibleEnabledScenarios.length === 0}
              className="w-3.5 h-3.5 rounded cursor-pointer accent-[var(--color-primary)]"
              title={
                isAllMasterSelected
                  ? "Deselect all visible scenarios"
                  : "Select all visible scenarios"
              }
            />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
              {selectedEndpoint ? "Endpoint Scenarios" : "All Test Scenarios"}
            </h3>
          </div>
          <div className="w-px h-3.5 bg-[var(--color-border)]/80" />
          <span className="text-xs text-[var(--color-text-secondary)] font-mono">
            <strong className="text-[var(--color-text)] font-semibold">{selectedCount}</strong> of {visibleEnabledScenarios.length} selected
          </span>
          <div className="w-px h-3.5 bg-[var(--color-border)]/80" />
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors ${
              isApproved
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
            }`}
            title={
              isApproved
                ? "Suite Status: All scenarios in this test suite have been reviewed and approved for Jest test execution."
                : "Suite Status: Pending review. Clicking 'Run Selected' will approve and execute the selected scenarios."
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isApproved ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            <span>Suite: {isApproved ? "Approved" : "Pending Review"}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onReGenerateSelected && (
            <button
              type="button"
              onClick={handleHeaderReGenerate}
              disabled={isGenerating || isApprovingAndRunning}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold hover:bg-[var(--color-surface-hover)] transition-colors shadow-xs disabled:opacity-40 cursor-pointer"
              title={reGenerateInfo.tooltip}
            >
              <RefreshCw
                size={12}
                className={isGenerating ? "animate-spin text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"}
              />
              <span>{isGenerating ? "Regenerating..." : reGenerateInfo.label}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleTopAddClick}
            disabled={!selectedEndpoint && availableTargetEndpoints.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold hover:bg-[var(--color-surface-hover)] transition-colors shadow-xs disabled:opacity-40 cursor-pointer"
            title={selectedEndpoint ? `Add Scenario to ${selectedEndpoint.method} ${selectedEndpoint.path || selectedEndpoint.route}` : "Add Scenario"}
          >
            <Plus size={13} />
            <span>Add Scenario</span>
          </button>

          {/* Apply to Source Code Button */}
          {onOpenApplyModal && (
            <button
              type="button"
              onClick={() => onOpenApplyModal(visibleSelectedIds)}
              disabled={selectedCount === 0 || isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-opacity shadow-xs disabled:opacity-40 cursor-pointer"
              title={
                selectedCount > 0
                  ? `Apply ${selectedCount} kịch bản đã chọn vào mã nguồn dự án`
                  : "Chọn ít nhất 1 kịch bản để apply"
              }
            >
              <HardDriveDownload size={13} />
              <span>Apply vào Mã Nguồn ({selectedCount})</span>
            </button>
          )}

          {onApproveAndRun && (
            <button
              type="button"
              onClick={() => {
                if (selectedCount === 0) return;

                // Pre-execution validation: inspect all selected scenarios for fatal errors
                const invalidScenarios = [];
                aiTests.forEach((t) => {
                  if (!t.content) return;
                  const tMarkers = getScenarioMonacoMarkers(t.content);
                  const fatalMarkers = tMarkers.filter((m) => m.severity === 8);
                  if (fatalMarkers.length > 0) {
                    (t.requests || []).forEach((r) => {
                      const scenarioId = r.scenarioId || r.id;
                      const fullId = `${t.id}::${scenarioId}`;
                      if (visibleSelectedIds.includes(fullId) || visibleSelectedIds.includes(scenarioId)) {
                        invalidScenarios.push({
                          name: r.testName,
                          message: fatalMarkers[0].message,
                        });
                      }
                    });
                  }
                });

                if (invalidScenarios.length > 0) {
                  const first = invalidScenarios[0];
                  const msg = `Cannot run tests: Scenario "${first.name}" contains code errors (${first.message}). Please fix before running.`;
                  if (onError) {
                    onError(msg);
                  } else {
                    alert(msg);
                  }
                  return;
                }

                onApproveAndRun(visibleSelectedIds);
              }}
              disabled={selectedCount === 0 || isApprovingAndRunning || isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs disabled:opacity-40 cursor-pointer"
              title={
                selectedCount > 0
                  ? `Approve and execute ${selectedCount} selected scenarios`
                  : "Select scenarios to run"
              }
            >
              <PlayCircle size={13} />
              <span>{isApprovingAndRunning ? "Starting..." : `Run Selected (${selectedCount})`}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Scalability Controls Toolbar: Live Search & Quick Filter Pills */}
      <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        {/* Live Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search scenarios, paths, codes (e.g. 200, 400, cart, error)..."
            className="w-full pl-8 pr-16 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors font-sans"
          />
          {searchQuery && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-[var(--color-primary)] font-semibold">
                {visibleEnabledScenarios.length}
              </span>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                title="Clear search"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTypeFilter("ALL")}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
              activeTypeFilter === "ALL"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-transparent"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            <span>All</span>
            <span className="font-mono text-[10px] opacity-80">({filterCounts.all})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTypeFilter("AI")}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
              activeTypeFilter === "AI"
                ? "bg-purple-600 text-white border-transparent"
                : "bg-[var(--color-surface)] text-purple-600 dark:text-purple-400 border-[var(--color-border)] hover:bg-purple-500/10"
            }`}
            title="Baseline scenarios generated automatically by CovAI"
          >
            <Sparkles size={11} />
            <span>AI Baseline</span>
            <span className="font-mono text-[10px] opacity-80">({filterCounts.ai})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTypeFilter("ADDED")}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
              activeTypeFilter === "ADDED"
                ? "bg-emerald-600 text-white border-transparent"
                : "bg-[var(--color-surface)] text-emerald-600 dark:text-emerald-400 border-[var(--color-border)] hover:bg-emerald-500/10"
            }`}
            title="Custom scenarios created manually by user"
          >
            <Plus size={11} />
            <span>Added</span>
            <span className="font-mono text-[10px] opacity-80">({filterCounts.added})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTypeFilter("MODIFIED")}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
              activeTypeFilter === "MODIFIED"
                ? "bg-amber-600 text-white border-transparent"
                : "bg-[var(--color-surface)] text-amber-600 dark:text-amber-400 border-[var(--color-border)] hover:bg-amber-500/10"
            }`}
            title="AI scenarios modified by user"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Modified</span>
            <span className="font-mono text-[10px] opacity-80">({filterCounts.modified})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTypeFilter("HAPPY_PATH")}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
              activeTypeFilter === "HAPPY_PATH"
                ? "bg-emerald-600 text-white border-transparent"
                : "bg-[var(--color-surface)] text-emerald-600 dark:text-emerald-400 border-[var(--color-border)] hover:bg-emerald-500/10"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Happy Path</span>
            <span className="font-mono text-[10px] opacity-80">({filterCounts.happy})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTypeFilter("VALIDATION")}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
              activeTypeFilter === "VALIDATION"
                ? "bg-amber-600 text-white border-transparent"
                : "bg-[var(--color-surface)] text-amber-600 dark:text-amber-400 border-[var(--color-border)] hover:bg-amber-500/10"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Edge & Errors</span>
            <span className="font-mono text-[10px] opacity-80">({filterCounts.validation})</span>
          </button>

          {filterCounts.disabled > 0 && (
            <button
              type="button"
              onClick={() => setActiveTypeFilter("DISABLED")}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
                activeTypeFilter === "DISABLED"
                  ? "bg-neutral-600 text-white border-transparent"
                  : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
              }`}
            >
              <span>Disabled</span>
              <span className="font-mono text-[10px] opacity-80">({filterCounts.disabled})</span>
            </button>
          )}
        </div>

        {/* Expand / Collapse All Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleExpandAll}
            className="px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] rounded hover:bg-[var(--color-surface)] cursor-pointer"
            title="Expand all modules and endpoints"
          >
            Expand All
          </button>
          <span className="text-[var(--color-text-muted)] text-[10px]">|</span>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] rounded hover:bg-[var(--color-surface)] cursor-pointer"
            title="Collapse all modules"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* 3. Endpoint Focus Notice (when filtered by sidebar selection) */}
      {selectedEndpoint && (
        <div className="px-4 py-1.5 bg-[var(--color-primary)]/10 border-b border-[var(--color-primary)]/20 flex items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 text-[var(--color-primary)] min-w-0">
            <Filter size={13} className="shrink-0" />
            <span className="truncate">
              Focused on endpoint:{" "}
              <strong className="font-mono">
                {selectedEndpoint.method} {selectedEndpoint.path || selectedEndpoint.route}
              </strong>
            </span>
          </div>
          {onClearSelectedEndpoint && (
            <button
              type="button"
              onClick={onClearSelectedEndpoint}
              className="text-[11px] font-semibold text-[var(--color-primary)] hover:underline shrink-0 cursor-pointer"
            >
              View All Modules & Endpoints
            </button>
          )}
        </div>
      )}

      {/* 4. 3-Tier Hierarchical Scenarios List (Module -> Endpoint -> Priority-Sorted Scenarios) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar">
        {filteredModules.length === 0 ? (
          <div className="text-center text-[var(--color-text-secondary)] py-12 text-xs font-mono">
            {searchQuery || activeTypeFilter !== "ALL"
              ? "No scenarios match the current search or filter criteria."
              : hasGeneratedTests
                ? "Zero scenarios produced for this selection."
                : "No scenarios found. Click 'Generate Test Scenarios' to create scenarios automatically."}
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {filteredModules.map((mod) => {
              const isModCollapsed = searchQuery.trim() ? false : collapsedModules.has(mod.name);

              // Module level selection stats
              const modEnabledScenarios = [];
              let modTotalScenarios = 0;
              mod.endpoints.forEach((ep) => {
                (ep.filteredScenarios || []).forEach((s) => {
                  modTotalScenarios++;
                  if (s.enabled) modEnabledScenarios.push(s.id);
                });
              });
              const modSelectedCount = modEnabledScenarios.filter((id) => selectedTestIds.includes(id)).length;
              const isAllModSelected = modEnabledScenarios.length > 0 && modSelectedCount === modEnabledScenarios.length;
              const isModIndeterminate = modSelectedCount > 0 && modSelectedCount < modEnabledScenarios.length;

              const hasModEmphasized = mod.endpoints.some((ep) =>
                (ep.filteredScenarios || []).some(
                  (s) => s.origin === "USER_ADDED" || s.origin === "USER_MODIFIED" || s.userEdited
                )
              );

              return (
                /* LEVEL 1: MODULE CONTAINER */
                <div
                  key={mod.name}
                  className="border border-[var(--color-border)] rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-xs transition-colors overflow-hidden"
                >
                  {/* Module Header */}
                  <div
                    onClick={() => toggleModuleCollapse(mod.name)}
                    className={`px-3 py-2 bg-[var(--color-surface-secondary)]/60 ${
                      !isModCollapsed ? "border-b border-[var(--color-border)]" : ""
                    } flex items-center justify-between cursor-pointer select-none hover:bg-[var(--color-surface-secondary)] transition-colors`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0">
                        <IndeterminateCheckbox
                          checked={isAllModSelected}
                          indeterminate={isModIndeterminate}
                          onChange={(e) => handleToggleModule(mod, e)}
                          disabled={modEnabledScenarios.length === 0}
                          className="w-3.5 h-3.5 rounded cursor-pointer accent-[var(--color-primary)]"
                          title={isAllModSelected ? `Deselect all in ${mod.name}` : `Select all in ${mod.name}`}
                        />
                      </div>
                      <span className="text-[var(--color-text-muted)] shrink-0">
                        {isModCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </span>
                      <span className="text-[var(--color-primary)] shrink-0">
                        {isModCollapsed ? <Folder size={15} /> : <FolderOpen size={15} />}
                      </span>
                      <span className="font-mono text-xs font-bold tracking-wider text-[var(--color-text)]">
                        {mod.name}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                        ({mod.endpoints.length} {mod.endpoints.length === 1 ? "endpoint" : "endpoints"})
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 text-xs">
                      {isModCollapsed && hasModEmphasized && (
                        <span
                          className="w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-400/90 shrink-0 shadow-xs ring-2 ring-amber-400/20"
                          title="Contains emphasized items"
                        />
                      )}
                      <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                        <strong className="text-[var(--color-text)] font-semibold">{modSelectedCount}</strong>/{modTotalScenarios} selected
                      </span>
                    </div>
                  </div>

                  {/* LEVEL 2: ENDPOINTS WITHIN MODULE */}
                  {!isModCollapsed && (
                    <div className="p-3 bg-[var(--color-bg)]/30 flex flex-col gap-2.5">
                      {mod.endpoints.map((ep) => {
                        const epKey = `${ep.method} ${ep.path}`;
                        const isEpCollapsed = searchQuery.trim() ? false : collapsedEndpoints.has(epKey);
                        const methodClass = METHOD_STYLES[ep.method] || METHOD_STYLES.DEFAULT;

                        const epEnabledScenarios = (ep.filteredScenarios || []).filter((s) => s.enabled).map((s) => s.id);
                        const epSelectedCount = epEnabledScenarios.filter((id) => selectedTestIds.includes(id)).length;
                        const isAllEpSelected = epEnabledScenarios.length > 0 && epSelectedCount === epEnabledScenarios.length;
                        const isEpIndeterminate = epSelectedCount > 0 && epSelectedCount < epEnabledScenarios.length;

                        const hasEpEmphasized = (ep.filteredScenarios || []).some(
                          (s) => s.origin === "USER_ADDED" || s.origin === "USER_MODIFIED" || s.userEdited
                        );

                        return (
                          /* LEVEL 2: ENDPOINT CARD */
                          <div
                            key={epKey}
                            className="border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] shadow-xs transition-colors overflow-hidden"
                          >
                            {/* Endpoint Header */}
                            <div
                              onClick={() => toggleEndpointCollapse(epKey)}
                              className={`px-3 py-1.5 bg-[var(--color-surface)] ${
                                !isEpCollapsed ? "border-b border-[var(--color-border)]/70" : ""
                              } flex items-center justify-between cursor-pointer select-none hover:bg-[var(--color-surface-hover)] transition-colors`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0">
                                  <IndeterminateCheckbox
                                    checked={isAllEpSelected}
                                    indeterminate={isEpIndeterminate}
                                    onChange={(e) => handleToggleEndpoint(ep, e)}
                                    disabled={epEnabledScenarios.length === 0}
                                    className="w-3.5 h-3.5 rounded cursor-pointer accent-[var(--color-primary)]"
                                    title={isAllEpSelected ? `Deselect all for ${epKey}` : `Select all for ${epKey}`}
                                  />
                                </div>
                                <span className="text-[var(--color-text-muted)] shrink-0">
                                  {isEpCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                </span>
                                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border tracking-tight shrink-0 ${methodClass}`}>
                                  {ep.method}
                                </span>
                                <span className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={ep.path}>
                                  {ep.path}
                                </span>
                              </div>

                              <div className="flex items-center gap-2.5 shrink-0 text-xs">
                                {isEpCollapsed && hasEpEmphasized && (
                                  <span
                                    className="w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-400/90 shrink-0 shadow-xs ring-2 ring-amber-400/20"
                                    title="Contains emphasized items"
                                  />
                                )}
                                <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                                  {epSelectedCount}/{ep.filteredScenarios.length} selected
                                </span>
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => handleAddClick(ep)}
                                    className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                                    title={`Add scenario to ${epKey}`}
                                  >
                                    <Plus size={13} />
                                  </button>
                                  {onGenerateThisEndpoint && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGeneratingEndpointKey(epKey);
                                        onGenerateThisEndpoint(epKey);
                                      }}
                                      disabled={isGenerating}
                                      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50"
                                      title={`Regenerate scenarios for ${epKey}`}
                                    >
                                      <RefreshCw
                                        size={12}
                                        className={
                                          isGenerating && generatingEndpointKey === epKey
                                            ? "animate-spin text-[var(--color-primary)]"
                                            : isGenerating && !generatingEndpointKey
                                            ? "animate-spin text-[var(--color-primary)] opacity-50"
                                            : ""
                                        }
                                      />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* LEVEL 3: SCENARIOS (Sorted by Priority Matrix) */}
                            {!isEpCollapsed && (
                              <div className="divide-y divide-[var(--color-border)]/60">
                                {ep.filteredScenarios.map((scenario) => {
                                  const isProcessing = processingScenarioId === scenario.id;
                                  const isSelected = selectedTestIds.includes(scenario.id);
                                  const isMenuOpen = activeMenuScenarioId === scenario.id;
                                  const classification = getScenarioClassification(scenario);

                                  return (
                                    <div
                                      key={scenario.id}
                                      className={`px-3 py-1.5 flex items-center justify-between gap-3 text-xs transition-colors group relative ${
                                        isMenuOpen ? "z-30" : "z-1"
                                      } ${
                                        !scenario.enabled
                                          ? "bg-[var(--color-bg)]/40 opacity-60"
                                          : !isSelected
                                            ? "bg-[var(--color-surface)] opacity-75 hover:opacity-100"
                                            : "bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]"
                                      }`}
                                    >
                                      {/* Left: Checkbox & Priority Badge & Clickable Title */}
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedTestIds((prev) => [...prev, scenario.id]);
                                            } else {
                                              setSelectedTestIds((prev) => prev.filter((x) => x !== scenario.id));
                                            }
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          disabled={!scenario.enabled || isProcessing}
                                          className="w-3.5 h-3.5 rounded cursor-pointer accent-[var(--color-primary)] shrink-0"
                                        />

                                        <div
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!isProcessing) {
                                              handleOpenEditorForScenario(scenario);
                                            }
                                          }}
                                          className="flex items-center gap-2 min-w-0 truncate flex-1 cursor-pointer group/title select-none py-0.5"
                                          title="Click scenario to edit"
                                        >
                                          {/* Priority Matrix Badge */}
                                          {scenario.enabled && (
                                            <span
                                              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border shrink-0 ${classification.badgeStyle}`}
                                            >
                                              {classification.label}
                                            </span>
                                          )}

                                          {/* Scenario Title */}
                                          <span
                                            className={`truncate transition-colors ${
                                              !scenario.enabled
                                                ? "line-through text-[var(--color-text-muted)]"
                                                : isSelected
                                                  ? "font-medium text-[var(--color-text)] group-hover/title:text-[var(--color-primary)] group-hover/title:underline underline-offset-2"
                                                  : "text-[var(--color-text-secondary)] group-hover/title:text-[var(--color-primary)] group-hover/title:underline underline-offset-2"
                                            }`}
                                            title={scenario.testName}
                                          >
                                            {scenario.testName}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Right: Milestone Badge (AI, A, M) + Status Indicator + Actions */}
                                      <div className="flex items-center gap-2 shrink-0">
                                        {/* Right-aligned short Git-style Milestone Badge */}
                                        {(() => {
                                          const originMeta = getScenarioOrigin(scenario);
                                          return (
                                            <span
                                              className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border shrink-0 cursor-default ${originMeta.badgeStyle}`}
                                              title={originMeta.tooltip}
                                            >
                                              {originMeta.badge}
                                            </span>
                                          );
                                        })()}

                                        {/* Disabled indicator */}
                                        {!scenario.enabled && (
                                          <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)] shrink-0">
                                            Disabled
                                          </span>
                                        )}

                                        {/* Skipped indicator */}
                                        {scenario.enabled && !isSelected && (
                                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/20 shrink-0">
                                            ○ Skipped
                                          </span>
                                        )}

                                        {/* Processing indicator */}
                                        {isProcessing && (
                                          <span className="flex items-center gap-1 text-[11px] text-[var(--color-primary)] font-mono animate-pulse mr-1">
                                            <RefreshCw size={11} className="animate-spin" />
                                            <span>Processing...</span>
                                          </span>
                                        )}

                                        {/* Context Menu Dropdown */}
                                        {!isApproved && (
                                          <div className="relative shrink-0" data-context-menu>
                                            <button
                                              type="button"
                                              disabled={isProcessing}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveMenuScenarioId(isMenuOpen ? null : scenario.id);
                                              }}
                                              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                                              title="More options"
                                            >
                                              <MoreHorizontal size={14} />
                                            </button>

                                            {isMenuOpen && (
                                              <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] shadow-lg py-1 min-w-[170px] font-sans">
                                                {/* Milestone Header */}
                                                {(() => {
                                                  const originMeta = getScenarioOrigin(scenario);
                                                  return (
                                                    <div className="px-3 py-1.5 border-b border-[var(--color-border)] text-[10px] font-mono bg-[var(--color-surface-secondary)]/50">
                                                      <div className="font-semibold text-[var(--color-text)]">{originMeta.label}</div>
                                                    </div>
                                                  );
                                                })()}

                                                {getScenarioOrigin(scenario).type === "USER_MODIFIED" && (
                                                  <button
                                                    type="button"
                                                    disabled={isProcessing}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleAction("REGENERATE", scenario);
                                                    }}
                                                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 flex items-center gap-2 cursor-pointer transition-colors"
                                                    title="Revert scenario back to original AI baseline code"
                                                  >
                                                    <RefreshCw size={12} />
                                                    <span>Revert to AI Baseline</span>
                                                  </button>
                                                )}

                                                <button
                                                  type="button"
                                                  disabled={isProcessing}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleAction("REGENERATE", scenario);
                                                  }}
                                                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] flex items-center gap-2 cursor-pointer transition-colors"
                                                >
                                                  <RefreshCw
                                                    size={12}
                                                    className={
                                                      isProcessing
                                                        ? "animate-spin text-[var(--color-primary)]"
                                                        : "text-[var(--color-text-muted)]"
                                                    }
                                                  />
                                                  <span>Regenerate (AI)</span>
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={isProcessing}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleAction("TOGGLE", scenario);
                                                  }}
                                                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] flex items-center gap-2 cursor-pointer transition-colors"
                                                >
                                                  <Power size={12} className="text-[var(--color-text-muted)]" />
                                                  <span>{scenario.enabled ? "Disable" : "Enable"}</span>
                                                </button>
                                                <div className="my-1 border-t border-[var(--color-border)]" />
                                                <button
                                                  type="button"
                                                  disabled={isProcessing}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveMenuScenarioId(null);
                                                    setDeleteTarget(scenario);
                                                  }}
                                                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 flex items-center gap-2 cursor-pointer transition-colors"
                                                >
                                                  <Trash2 size={12} />
                                                  <span>Delete</span>
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
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
              );
            })}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      <IntegrationScenarioEditorModal
        isOpen={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setAddingToEndpoint(null);
          setEditingScenario(null);
        }}
        onSave={handleSaveEditor}
        onSaveAndApply={handleSaveAndApplyEditor}
        initialCode={editorCode}
        title={editorTitle}
        loading={editorLoading}
        targetEndpoint={addingToEndpoint?.endpoint}
        availableEndpoints={availableTargetEndpoints}
        existingScenarioTitles={existingTitlesForEndpoint}
        isAddMode={Boolean(addingToEndpoint)}
        onSelectTargetEndpoint={(newEp) => {
          setAddingToEndpoint({
            aiTestId: newEp.testFileId,
            endpoint: { method: newEp.method, path: newEp.path },
          });
          setEditorTitle(`Add Scenario: ${newEp.method} ${newEp.path}`);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            handleAction("DELETE", deleteTarget);
            setDeleteTarget(null);
          }
        }}
        title="Delete Test Scenario"
        message={`Are you sure you want to delete "${deleteTarget?.testName}" permanently?`}
        confirmText="Delete Scenario"
        cancelText="Cancel"
        variant="danger"
        icon={Trash2}
      />

      {/* Re-Generate All Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showRegenerateAllConfirm}
        onClose={() => setShowRegenerateAllConfirm(false)}
        onConfirm={() => {
          setShowRegenerateAllConfirm(false);
          if (onReGenerateSelected) onReGenerateSelected(null);
        }}
        title="Re-Generate All Endpoints?"
        message="This will re-generate test scenarios for all endpoints in the project. Any existing AI-generated scenarios will be updated while your custom scenarios will be preserved. Do you wish to continue?"
        confirmText="Re-Generate All"
        cancelText="Cancel"
        variant="primary"
        icon={RefreshCw}
      />
    </div>
  );
}
