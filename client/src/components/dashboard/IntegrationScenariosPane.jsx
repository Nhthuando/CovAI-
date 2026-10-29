import { getIntegrationScenarioApi, mutateIntegrationScenarioApi } from "../../services/integrationScenario.service";
import { getJobDetailApi } from "../../services/job.service";
import { useToast } from "./ToastContext";
import { useState } from "react";
import IntegrationScenarioEditorModal from "./integration/IntegrationScenarioEditorModal.jsx";
import ConfirmDialog from "../common/ConfirmDialog";
import {
  Plus,
  Edit2,
  Sparkles,
  Trash2,
  Power,
  CheckCircle2,
  Clock,
} from "lucide-react";

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
  onScenarioChange,
  onError,
}) {
  const { showToast } = useToast();
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

  // Group tests by endpoint for the view
  const scenariosByEndpoint = {};
  aiTests.forEach((t) => {
    t.requests.forEach((r) => {
      const epKey = `${r.method.toUpperCase()} ${r.path}`;
      if (!scenariosByEndpoint[epKey]) {
        scenariosByEndpoint[epKey] = {
          method: r.method.toUpperCase(),
          path: r.path,
          isValid: t.isValid,
          filePath: t.filePath,
          scenarios: [],
          testFileId: t.id,
          version: t.version,
          fileStatus: t.status,
        };
      }
      scenariosByEndpoint[epKey].scenarios.push({
        ...r,
        version: t.version,
        id: `${t.id}::${r.scenarioId}`,
        enabled: r.enabled !== false,
        userEdited: r.userEdited,
      });
    });
  });

  const endpointKeys = selectedEndpoint
    ? [`${selectedEndpoint.method} ${selectedEndpoint.path}`]
    : Object.keys(scenariosByEndpoint);

  const reportError = (error, editing = false) => {
    const message = error.status === 409
      ? `${error.message} ${editing ? "Your draft is preserved. Close and reopen the editor to review the latest version." : "Refresh the scenario list before retrying."}`
      : error.message;
    onError?.(message);
    showToast({ type: "error", title: error.status === 409 ? "Scenario changed" : "Scenario action failed", message });
  };

  const handleAction = async (action, scenario) => {
    if (processingScenarioId) return;
    setProcessingScenarioId(scenario.id);
    try {
      const [aiTestId, ...parts] = scenario.id.split("::");
      const result = await mutateIntegrationScenarioApi({
        snapshotId, aiTestId, scenarioId: parts.join("::"), action,
        expectedVersion: scenario.version,
        ...(action === "TOGGLE" ? { enable: !scenario.enabled } : {}),
      });
      if (action === "DELETE" || (action === "TOGGLE" && scenario.enabled)) {
        setSelectedTestIds(previous => previous.filter(id => id !== scenario.id));
      }
      const jobId = result.jobId || result.job?.id;
      if (jobId) {
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const response = await getJobDetailApi(jobId);
          const job = response.job || response.data;
          if (!job) throw new Error("Could not read regeneration status");
          if (job.status === "SUCCESS") break;
          if (["FAILED", "CANCELED"].includes(job.status)) throw new Error(job.errorMessage || "Regeneration failed");
        }
      }
      onScenarioChange?.();
    } catch (error) {
      reportError(error);
    } finally {
      setProcessingScenarioId(null);
    }
  };

  const handleEditScenario = async scenario => {
    if (processingScenarioId) return;
    const [aiTestId, ...parts] = scenario.id.split("::");
    const scenarioId = parts.join("::");
    setProcessingScenarioId(scenario.id);
    try {
      const result = await getIntegrationScenarioApi(snapshotId, aiTestId, scenarioId);
      setEditingScenario({ aiTestId, scenarioId, expectedVersion: result.version || result.aiTest?.version });
      setAddingToEndpoint(null);
      setEditorTitle(`Edit Scenario: ${scenario.testName}`);
      setEditorCode(result.code);
      setEditorOpen(true);
    } catch (error) {
      reportError(error);
    } finally {
      setProcessingScenarioId(null);
    }
  };

  const handleAddClick = (data) => {
    setAddingToEndpoint({
      aiTestId: data.testFileId,
      expectedVersion: data.version,
      endpoint: { method: data.method, path: data.path },
    });
    setEditorTitle(`Add Scenario to ${data.method} ${data.path}`);
    setEditorCode(
      `it('should handle a new case', async () => {\n  // Arrange\n  \n  // Act\n  \n  // Assert\n  expect(true).toBe(true);\n});`,
    );
    setEditorOpen(true);
  };

  const handleSaveEditor = async code => {
    setEditorLoading(true);
    try {
      if (addingToEndpoint) {
        await mutateIntegrationScenarioApi({ snapshotId, aiTestId: addingToEndpoint.aiTestId, action: "ADD", code,
          endpoint: addingToEndpoint.endpoint, expectedVersion: addingToEndpoint.expectedVersion });
      } else if (editingScenario) {
        await mutateIntegrationScenarioApi({ snapshotId, aiTestId: editingScenario.aiTestId,
          scenarioId: editingScenario.scenarioId, action: "UPDATE", code, expectedVersion: editingScenario.expectedVersion });
      }
      setEditorOpen(false);
      onScenarioChange?.();
    } catch (error) {
      reportError(error, true);
    } finally {
      setEditorLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text)]">
          Test Scenarios
        </h3>
        <div className="text-xs text-[var(--color-text-secondary)] flex items-center gap-3">
          <span>
            Total: {aiTests.reduce((acc, t) => acc + t.requests.length, 0)}
          </span>
          <span
            className={`font-semibold ${
              isApproved
                ? "text-[var(--color-success)]"
                : "text-[var(--color-warning)]"
            }`}
          >
            Status: {isApproved ? "Approved" : "Pending Review"}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {endpointKeys.length === 0 || !scenariosByEndpoint[endpointKeys[0]] ? (
          <div className="text-center text-[var(--color-text-secondary)] py-10 text-xs">
            No scenarios found for this endpoint.
          </div>
        ) : (
          endpointKeys.map((key) => {
            const data = scenariosByEndpoint[key];
            if (!data) return null;

            return (
              <div
                key={key}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden"
              >
                {/* Endpoint Header */}
                <div className="px-4 py-3 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs font-semibold text-[var(--color-primary)]">
                      {key}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] font-mono mt-0.5">
                      {data.filePath}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const matchedEndpoint = (endpoints || []).find(e => `${e.method} ${e.route}` === key);
                      const hasSourceMap = matchedEndpoint && matchedEndpoint.source && matchedEndpoint.source.sourceFile;
                      
                      if (hasSourceMap) {
                        return (
                          <>
                            {onSuggestTestcase && (
                              <button
                                type="button"
                                onClick={() => onSuggestTestcase(matchedEndpoint.source.sourceFile)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/25 text-xs font-semibold hover:bg-[var(--color-warning)]/20 transition-colors cursor-pointer"
                                title="Suggest Unit Tests for this logic"
                              >
                                <Sparkles size={12} />
                                Suggest Unit Tests
                              </button>
                            )}
                            {onOpenCFG && matchedEndpoint.source.controllerMethod && (
                              <button
                                type="button"
                                onClick={() => onOpenCFG(matchedEndpoint.source.sourceFile, matchedEndpoint.source.controllerMethod)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-md)] bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/25 text-xs font-semibold hover:bg-[#3b82f6]/20 transition-colors cursor-pointer"
                                title="View Logic Analysis (CFG)"
                              >
                                View Logic Analysis
                              </button>
                            )}
                          </>
                        );
                      }
                      return null;
                    })()}
                    <button
                      type="button"
                      onClick={() => handleAddClick(data)}
                      disabled={isApproved}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/25 text-xs font-semibold hover:bg-[var(--color-primary)]/20 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Plus size={12} />
                      Add Scenario
                    </button>
                  </div>
                </div>

                {/* Scenarios List */}
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
                                onClick={() => handleEditScenario(scenario)}
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
