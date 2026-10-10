import { useState, useMemo } from "react";
import IntegrationScenarioEditorModal from "./IntegrationScenarioEditorModal.jsx";
import ConfirmDialog from "../../common/ConfirmDialog";
import {
  Plus,
  Edit2,
  Trash2,
  Power,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

const statusColor = (status) => {
  if (status === "Covered" || status === "PASSED" || status === "APPROVED")
    return "var(--color-success)";
  if (status === "Partial" || status === "DRAFT") return "var(--color-warning)";
  if (status === "Uncovered" || status === "FAILED")
    return "var(--color-danger)";
  return "var(--color-text-muted)";
};

export default function IntegrationScenariosPane({
  aiTests,
  selectedEndpoint,
  hasGeneratedTests,
  isApproved,
  selectedTestIds,
  setSelectedTestIds,
  snapshotId,
  endpoints,
  onOpenCFG,
  onSuggestTestcase,
  onOpenArchitecture,
  onScenarioChange,
  onError,
  onGenerateThisEndpoint,
  isGenerating = false,
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCode, setEditorCode] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);

  // Edit mode state
  const [editingScenario, setEditingScenario] = useState(null);
  // Add mode state
  const [addingToEndpoint, setAddingToEndpoint] = useState(null);
  const [processingScenarioId, setProcessingScenarioId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [collapsedCards, setCollapsedCards] = useState(new Set());

  const toggleCardCollapse = (key) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (!hasGeneratedTests) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center gap-3 text-[var(--color-text-secondary)] font-sans">
        <Clock
          size={32}
          className="text-[var(--color-text-muted)] opacity-60"
        />
        <div className="text-xs">
          <p className="font-semibold text-[var(--color-text)] mb-1">
            No test scenarios have been generated yet.
          </p>
          <p>
            Run <strong>Generate Tests</strong> to let AI create test cases for
            your endpoints.
          </p>
        </div>
      </div>
    );
  }

  // Helper to match an executed request URL back to the declared API endpoint
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

  // Group tests by endpoint for the view
  const scenariosByEndpoint = {};
  aiTests.forEach((t) => {
    t.requests.forEach((r, idx) => {
      const matchedEp = findMatchingEndpoint(r.method, r.path);
      const epMethod = matchedEp ? matchedEp.method.toUpperCase() : r.method.toUpperCase();
      const epPath = matchedEp ? (matchedEp.path || matchedEp.route || matchedEp.fullPath) : (r.path || "").split("?")[0];
      const epKey = `${epMethod} ${epPath}`;

      if (!scenariosByEndpoint[epKey]) {
        scenariosByEndpoint[epKey] = {
          method: epMethod,
          path: epPath,
          isValid: t.isValid,
          filePath: t.filePath,
          scenarios: [],
          testFileId: t.id,
          fileStatus: t.status,
        };
      }
      scenariosByEndpoint[epKey].scenarios.push({
        ...r,
        id: `${t.id}::${r.scenarioId || r.testName || idx}`,
        enabled: r.enabled !== false,
        userEdited: r.userEdited,
      });
    });
  });

  const endpointKeys = selectedEndpoint
    ? [`${selectedEndpoint.method} ${selectedEndpoint.path || selectedEndpoint.route}`]
    : Object.keys(scenariosByEndpoint);

  const handleAction = async (action, scenario, data = {}) => {
    if (processingScenarioId) return;
    setProcessingScenarioId(scenario.id);

    try {
      const parts = scenario.id.split("::");
      const aiTestId = parts[0];
      const scenarioId = encodeURIComponent(parts.slice(1).join("::"));

      let url = `${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${aiTestId}/scenario/${scenarioId}`;
      let method = "POST";
      let body = {};

      if (action === "DELETE") {
        method = "DELETE";
      } else if (action === "TOGGLE") {
        url += "/toggle";
        method = "PATCH";
        body = { enable: !scenario.enabled };
      } else if (action === "REGENERATE") {
        url += "/regenerate";
      }

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: method !== "DELETE" ? JSON.stringify(body) : undefined,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message);
      if (result.jobId) {
        while (true) {
          await new Promise((r) => setTimeout(r, 2000));
          const jobRes = await fetch(`${BASE_URL}/job/${result.jobId}`, {
            headers: getAuthHeaders(),
          });
          if (!jobRes.ok) break;
          const jobData = await jobRes.json();
          if (jobData.data.status === "SUCCESS") {
            break;
          }
          if (
            jobData.data.status === "FAILED" ||
            jobData.data.status === "CANCELED"
          ) {
            throw new Error(jobData.data.errorMessage || "Regeneration failed");
          }
        }
      }

      if (onScenarioChange) onScenarioChange();
    } catch (err) {
      if (onError) onError(err.message);
    } finally {
      setProcessingScenarioId(null);
    }
  };

  const handleAddClick = (data) => {
    setAddingToEndpoint({
      aiTestId: data.testFileId,
      endpoint: { method: data.method, path: data.path },
    });
    setEditorTitle(`Add Scenario to ${data.method} ${data.path}`);
    setEditorCode(
      `it('should handle a new case', async () => {\n  // Arrange\n  \n  // Act\n  \n  // Assert\n  expect(true).toBe(true);\n});`,
    );
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
      if (onScenarioChange) onScenarioChange();
    } catch (err) {
      if (onError) onError(err.message);
    } finally {
      setEditorLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 font-sans text-[var(--color-text)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text)]">
            Test Scenarios
          </h3>
          <span className="text-xs text-[var(--color-text-secondary)] font-mono">
            Total: {aiTests.reduce((acc, t) => acc + t.requests.length, 0)}
          </span>
          <span
            className={`text-xs font-semibold ${
              isApproved
                ? "text-[var(--color-success)]"
                : "text-[var(--color-warning)]"
            }`}
          >
            Status: {isApproved ? "Approved" : "Pending Review"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTopAddClick}
            disabled={isApproved || (!selectedEndpoint && availableTargetEndpoints.length === 0)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary)]/90 transition-colors shadow-sm disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            title={selectedEndpoint ? `Add Scenario to ${selectedEndpoint.method} ${selectedEndpoint.path || selectedEndpoint.route}` : "Add Scenario"}
          >
            <Plus size={13} strokeWidth={2.5} />
            Add Scenario
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-20 flex flex-col gap-4 custom-scrollbar">
        {endpointKeys.length === 0 || !scenariosByEndpoint[endpointKeys[0]] ? (
          <div className="text-center text-[var(--color-text-secondary)] py-10 text-sm">
            {hasGeneratedTests
              ? "The generation job completed successfully, but zero scenarios were produced for this endpoint. You can try regenerating or manually adding a scenario."
              : "No scenarios found for this endpoint. Click 'Generate Tests' in the pipeline above to create scenarios automatically."}
          </div>
        ) : (
          endpointKeys.map((key) => {
            const data = scenariosByEndpoint[key];
            if (!data) return null;
            const isCollapsed = collapsedCards.has(key);

            return (
              <div
                key={key}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden shrink-0 transition-all shadow-xs"
              >
                {/* Endpoint Header */}
                <div
                  onClick={() => toggleCardCollapse(key)}
                  className="px-4 py-3 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between cursor-pointer select-none hover:bg-[var(--color-surface)]/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">
                      {isCollapsed ? (
                        <ChevronRight size={15} />
                      ) : (
                        <ChevronDown size={15} />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-[var(--color-primary)] truncate">
                        {key}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)] font-mono mt-0.5 truncate">
                        {data.filePath}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isApproved && onGenerateThisEndpoint && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onGenerateThisEndpoint(key);
                        }}
                        disabled={isGenerating}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/25 hover:bg-[var(--color-primary)]/20 transition-colors cursor-pointer disabled:opacity-50"
                        title={`Regenerate scenarios for ${key}`}
                      >
                        <Sparkles size={11} />
                        {isGenerating ? "Working..." : "Regenerate"}
                      </button>
                    )}
                    <span className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-surface)] px-2 py-0.5 rounded border border-[var(--color-border)]">
                      {data.scenarios.length}{" "}
                      {data.scenarios.length === 1 ? "scenario" : "scenarios"}
                    </span>
                  </div>
                </div>

                {/* Scenarios List */}
                {!isCollapsed && (
                  <div className="divide-y divide-[var(--color-border)]">
                    {data.scenarios.map((scenario, idx) => {
                      const isProcessing = processingScenarioId === scenario.id;
                      return (
                        <div
                          key={idx}
                          className={`p-3.5 flex items-start gap-3 transition-colors ${
                            scenario.enabled && !isProcessing
                              ? "bg-[var(--color-surface)]"
                              : "bg-[var(--color-bg)] opacity-60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTestIds.includes(scenario.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTestIds((prev) => [
                                  ...prev,
                                  scenario.id,
                                ]);
                              } else {
                                setSelectedTestIds((prev) =>
                                  prev.filter((x) => x !== scenario.id),
                                );
                              }
                            }}
                            disabled={isApproved || !scenario.enabled}
                            className="mt-0.5 rounded cursor-pointer accent-[var(--color-primary)]"
                          />
                          <div className="flex-1 min-w-0">
                            <div
                              className={`text-xs font-semibold text-[var(--color-text)] mb-1 ${
                                !scenario.enabled ? "line-through opacity-60" : ""
                              }`}
                            >
                              {scenario.testName}
                            </div>
                            <div className="text-[11px] text-[var(--color-text-secondary)] flex items-center gap-3">
                              <span>
                                {scenario.userEdited ? "Custom" : "AI Generated"}
                              </span>
                              <span
                                className="font-semibold flex items-center gap-1"
                                style={{
                                  color: !scenario.enabled
                                    ? "var(--color-text-muted)"
                                    : statusColor(
                                        isApproved ? "APPROVED" : data.fileStatus,
                                      ),
                                }}
                              >
                                ●{" "}
                                {!scenario.enabled
                                  ? "DISABLED"
                                  : isApproved
                                    ? "APPROVED"
                                    : data.fileStatus || "DRAFT"}
                              </span>
                            </div>

                            {!isApproved && (
                              <div className="flex items-center gap-2 mt-2.5">
                                <button
                                  type="button"
                                  disabled={isProcessing}
                                  onClick={() => {
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
                                          setEditingScenario({
                                            aiTestId,
                                            scenarioId,
                                          });
                                          setAddingToEndpoint(null);
                                          setEditorTitle(
                                            `Edit Scenario: ${scenario.testName}`,
                                          );
                                          setEditorCode(res.data.code);
                                          setEditorOpen(true);
                                        }
                                      });
                                  }}
                                  className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={isProcessing}
                                  onClick={() =>
                                    handleAction("REGENERATE", scenario)
                                  }
                                  className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 text-[11px] font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 transition-colors cursor-pointer flex items-center gap-1"
                                >
                                  <Sparkles size={11} />
                                  {isProcessing &&
                                  processingScenarioId === scenario.id
                                    ? "Working..."
                                    : "Regenerate"}
                                </button>
                                <button
                                  type="button"
                                  disabled={isProcessing}
                                  onClick={() => handleAction("TOGGLE", scenario)}
                                  className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                                >
                                  {scenario.enabled ? "Disable" : "Enable"}
                                </button>
                                <button
                                  type="button"
                                  disabled={isProcessing}
                                  onClick={() => setDeleteTarget(scenario)}
                                  className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 text-[11px] font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20 transition-colors cursor-pointer"
                                >
                                  Delete
                                </button>
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
          })
        )}
      </div>

      <IntegrationScenarioEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveEditor}
        initialCode={editorCode}
        title={editorTitle}
        loading={editorLoading}
        targetEndpoint={addingToEndpoint?.endpoint}
        availableEndpoints={availableTargetEndpoints}
        onSelectTargetEndpoint={(newEp) => {
          setAddingToEndpoint({
            aiTestId: newEp.testFileId,
            endpoint: { method: newEp.method, path: newEp.path },
          });
          setEditorTitle(`Add Scenario to ${newEp.method} ${newEp.path}`);
        }}
      />

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
    </div>
  );
}
