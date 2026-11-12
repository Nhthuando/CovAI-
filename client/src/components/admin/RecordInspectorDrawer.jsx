import React, { useState, useEffect } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  Save,
  Copy,
  Check,
  Code2,
  FileSpreadsheet,
  Link2,
  History,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

/**
 * RecordInspectorDrawer — Detailed Side Panel for Record Inspection & Editing
 */
export function RecordInspectorDrawer({
  isOpen,
  onClose,
  record, // current record object
  modelName,
  schemaFields = [], // [{ name, type, isId, isRequired, isList }]
  primaryKeyField = "id",
  onSaveRecord, // async (updatedData) => void
  onNavigateToRelation, // (targetModel, targetId) => void
  auditLogs = [],
}) {
  const [activeTab, setActiveTab] = useState("form"); // 'form' | 'json' | 'relations' | 'audit'
  const [isExpanded, setIsExpanded] = useState(false);
  const [formData, setFormData] = useState({});
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (record) {
      setFormData({ ...record });
      setJsonText(JSON.stringify(record, null, 2));
      setJsonError(null);
    }
  }, [record]);

  if (!isOpen || !record) return null;

  const recordId = record[primaryKeyField] || record.id || "N/A";

  const handleFieldChange = (fieldName, val) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: val,
    }));
  };

  const handleJsonChange = (text) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setFormData(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError(e.message);
    }
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(formData, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSave = async () => {
    if (jsonError) return;
    setIsSaving(true);
    try {
      // Exclude primary key from update payload
      const payload = { ...formData };
      delete payload[primaryKeyField];
      delete payload.createdAt;
      delete payload.updatedAt;

      await onSaveRecord?.(payload);
    } finally {
      setIsSaving(false);
    }
  };

  // Find relations in record
  const relationEntries = Object.entries(record).filter(([k, v]) => {
    return v && typeof v === "object" && k !== "meta";
  });

  return (
    <div
      className={`fixed top-0 right-0 bottom-0 z-40 bg-[var(--admin-surface-raised)] border-l border-[var(--admin-border-strong)] shadow-2xl flex flex-col transition-all duration-200 ${
        isExpanded ? "w-full md:w-[840px]" : "w-full md:w-[560px]"
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--admin-border-subtle)] bg-[var(--admin-surface-overlay)] flex-shrink-0">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="p-1.5 rounded-md bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]">
            <FileSpreadsheet size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[var(--admin-text-high)] uppercase tracking-wider">
                {modelName}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--admin-surface-base)] text-[var(--admin-accent-telemetry)] border border-[var(--admin-border-subtle)] truncate max-w-[180px]">
                {recordId}
              </span>
            </div>
            <div className="text-[11px] text-[var(--admin-text-medium)]">
              Record Inspector & Mutation Drawer
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-base)] transition-colors"
            title={isExpanded ? "Collapse" : "Expand width"}
          >
            {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-base)] transition-colors"
            title="Close Drawer (ESC)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs Header */}
      <div className="flex items-center gap-1 px-5 border-b border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)] text-xs font-medium flex-shrink-0">
        <button
          onClick={() => setActiveTab("form")}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "form"
              ? "border-[var(--admin-accent-primary)] text-[var(--admin-accent-primary)]"
              : "border-transparent text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)]"
          }`}
        >
          <FileSpreadsheet size={13} />
          <span>Form View</span>
        </button>
        <button
          onClick={() => setActiveTab("json")}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "json"
              ? "border-[var(--admin-accent-primary)] text-[var(--admin-accent-primary)]"
              : "border-transparent text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)]"
          }`}
        >
          <Code2 size={13} />
          <span>Raw JSON</span>
        </button>
        <button
          onClick={() => setActiveTab("relations")}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "relations"
              ? "border-[var(--admin-accent-primary)] text-[var(--admin-accent-primary)]"
              : "border-transparent text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)]"
          }`}
        >
          <Link2 size={13} />
          <span>Relations ({relationEntries.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "audit"
              ? "border-[var(--admin-accent-primary)] text-[var(--admin-accent-primary)]"
              : "border-transparent text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)]"
          }`}
        >
          <History size={13} />
          <span>Audit Log</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* TAB 1: FORM VIEW */}
        {activeTab === "form" && (
          <div className="space-y-4">
            {schemaFields.length > 0 ? (
              schemaFields.map((field) => {
                const isPk = field.name === primaryKeyField || field.isId;
                const isTimestamp =
                  field.name === "createdAt" || field.name === "updatedAt";
                const isReadOnly = isPk || isTimestamp;
                const val = formData[field.name];

                return (
                  <div key={field.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <label className="font-mono font-medium text-[var(--admin-text-high)]">
                          {field.name}
                        </label>
                        {field.isRequired && (
                          <span className="text-[10px] text-[var(--admin-status-danger)]">*</span>
                        )}
                        <span className="text-[10px] font-mono text-[var(--admin-text-low)] bg-[var(--admin-surface-base)] px-1 rounded border border-[var(--admin-border-subtle)]">
                          {field.type}
                        </span>
                      </div>
                      {isReadOnly && (
                        <span className="text-[10px] font-mono text-[var(--admin-text-low)] uppercase">
                          Read-Only
                        </span>
                      )}
                    </div>

                    {field.type === "Boolean" ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => handleFieldChange(field.name, !val)}
                          className={`px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                            val
                              ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border-[var(--admin-border-accent)]"
                              : "bg-[var(--admin-surface-base)] text-[var(--admin-text-medium)] border-[var(--admin-border-subtle)]"
                          }`}
                        >
                          {val ? "TRUE" : "FALSE"}
                        </button>
                      </div>
                    ) : typeof val === "object" && val !== null ? (
                      <textarea
                        rows={3}
                        value={JSON.stringify(val, null, 2)}
                        onChange={(e) => {
                          try {
                            handleFieldChange(field.name, JSON.parse(e.target.value));
                          } catch {
                            // keep as is
                          }
                        }}
                        disabled={isReadOnly}
                        className="w-full px-3 py-2 text-xs font-mono rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)]"
                      />
                    ) : (
                      <input
                        type={field.type === "Int" || field.type === "Float" ? "number" : "text"}
                        value={val !== undefined && val !== null ? val : ""}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          handleFieldChange(
                            field.name,
                            field.type === "Int"
                              ? parseInt(e.target.value, 10) || 0
                              : field.type === "Float"
                              ? parseFloat(e.target.value) || 0
                              : e.target.value
                          )
                        }
                        className="w-full px-3 py-2 text-xs font-mono rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] disabled:opacity-50 disabled:bg-[var(--admin-surface-sunken)] focus:outline-none focus:border-[var(--admin-accent-primary)] transition-colors"
                      />
                    )}
                  </div>
                );
              })
            ) : (
              // Fallback dynamically from object keys
              Object.entries(formData).map(([k, val]) => (
                <div key={k} className="space-y-1">
                  <label className="text-xs font-mono text-[var(--admin-text-high)] block">{k}</label>
                  <input
                    type="text"
                    value={typeof val === "object" ? JSON.stringify(val) : val ?? ""}
                    onChange={(e) => handleFieldChange(k, e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)]"
                  />
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: RAW JSON VIEW */}
        {activeTab === "json" && (
          <div className="h-full flex flex-col space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--admin-text-medium)]">
              <span>Direct JSON Payload Inspector</span>
              <button
                type="button"
                onClick={handleCopyJson}
                className="flex items-center gap-1 text-[var(--admin-accent-primary)] hover:underline"
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                <span>{isCopied ? "Copied" : "Copy Payload"}</span>
              </button>
            </div>

            {jsonError && (
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--admin-status-danger-muted)] border border-[var(--admin-status-danger)]/40 text-[var(--admin-status-danger)] text-xs font-mono">
                <AlertCircle size={14} />
                <span>JSON Syntax Error: {jsonError}</span>
              </div>
            )}

            <textarea
              rows={22}
              value={jsonText}
              onChange={(e) => handleJsonChange(e.target.value)}
              className="flex-1 w-full p-3 font-mono text-xs rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)] leading-relaxed"
            />
          </div>
        )}

        {/* TAB 3: RELATIONS EXPLORER */}
        {activeTab === "relations" && (
          <div className="space-y-3">
            {relationEntries.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--admin-text-medium)]">
                No expanded relations found on this record.
              </div>
            ) : (
              relationEntries.map(([relKey, relData]) => (
                <div
                  key={relKey}
                  className="p-3.5 rounded-lg bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[var(--admin-accent-telemetry)]">
                        {relKey}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--admin-text-low)]">
                        {Array.isArray(relData) ? `Array (${relData.length})` : "Object"}
                      </span>
                    </div>

                    {relData && relData.id && (
                      <button
                        type="button"
                        onClick={() => onNavigateToRelation?.(relKey, relData.id)}
                        className="flex items-center gap-1 text-[11px] text-[var(--admin-accent-primary)] hover:underline"
                      >
                        <span>Drill-down</span>
                        <ExternalLink size={11} />
                      </button>
                    )}
                  </div>

                  <pre className="p-2 rounded bg-[var(--admin-surface-sunken)] text-[11px] font-mono text-[var(--admin-text-medium)] overflow-x-auto max-h-40">
                    {JSON.stringify(relData, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: AUDIT LOG */}
        {activeTab === "audit" && (
          <div className="space-y-2">
            {auditLogs.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--admin-text-medium)]">
                No audit log entries recorded for this entity yet.
              </div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-md bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-[var(--admin-accent-primary)]">
                      {log.action}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--admin-text-low)]">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--admin-text-medium)]">
                    Actor: <span className="font-mono text-[var(--admin-text-high)]">{log.actor?.email || log.actorId || "System"}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Drawer Action Bar */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--admin-border-subtle)] bg-[var(--admin-surface-overlay)] flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-3.5 py-1.5 text-xs rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] transition-colors admin-tactile-btn"
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={isSaving || !!jsonError}
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-[var(--admin-accent-primary)] hover:bg-[var(--admin-accent-primary-hover)] disabled:opacity-40 text-black transition-all admin-tactile-btn shadow-[0_0_12px_rgba(0,229,153,0.3)] cursor-pointer"
        >
          <Save size={13} />
          <span>{isSaving ? "Saving..." : "Save Changes"}</span>
        </button>
      </div>
    </div>
  );
}
