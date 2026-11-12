import React, { useState, useRef, useEffect } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  MoreVertical,
  Eye,
  Trash2,
  ExternalLink,
  Code,
  Check,
  X,
  Clock,
  Layers,
} from "lucide-react";

/**
 * Status Pill Renderer
 */
function StatusPill({ value }) {
  if (value === null || value === undefined) return <span className="text-[var(--admin-text-low)]">—</span>;
  const str = String(value).toUpperCase();

  let colorClasses = "bg-[var(--admin-surface-overlay)] text-[var(--admin-text-medium)] border-[var(--admin-border-subtle)]";
  let dotColor = "bg-[var(--admin-text-medium)]";

  if (["ACTIVE", "COMPLETED", "SUCCESS", "ONLINE", "HEALTHY", "READY", "PROD", "SUPERADMIN"].includes(str)) {
    colorClasses = "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border-[var(--admin-border-accent)]";
    dotColor = "bg-[var(--admin-accent-primary)]";
  } else if (["FAILED", "ERROR", "DANGER", "DEGRADED", "SUSPENDED", "BLOCKED"].includes(str)) {
    colorClasses = "bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] border-[var(--admin-status-danger)]/40";
    dotColor = "bg-[var(--admin-status-danger)]";
  } else if (["PENDING", "RUNNING", "WAITING", "WARNING", "OPERATOR"].includes(str)) {
    colorClasses = "bg-[var(--admin-status-warning-muted)] text-[var(--admin-status-warning)] border-[var(--admin-status-warning)]/40";
    dotColor = "bg-[var(--admin-status-warning)]";
  } else if (["ADMIN", "AI_READY", "DEV"].includes(str)) {
    colorClasses = "bg-[var(--admin-accent-telemetry-muted)] text-[var(--admin-accent-telemetry)] border-[var(--admin-accent-telemetry)]/40";
    dotColor = "bg-[var(--admin-accent-telemetry)]";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono border font-medium ${colorClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{str}</span>
    </span>
  );
}

/**
 * Format timestamp nicely
 */
function formatTimeRelative(dateString) {
  if (!dateString) return "—";
  try {
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  } catch {
    return String(dateString);
  }
}

/**
 * AdminDataGrid — High-Density Industrial Grid
 */
export function AdminDataGrid({
  columns = [], // [{ key, label, type, isId, width }]
  data = [],
  primaryKey = "id",
  selectedIds = [],
  onSelectIds,
  sortBy,
  sortDir = "desc",
  onSortChange,
  onRowClick,
  onDeleteRow,
  isLoading = false,
  emptyMessage = "No records found.",
}) {
  const [colWidths, setColWidths] = useState({});
  const resizingColRef = useRef(null);

  // Initialize column widths
  useEffect(() => {
    const initial = {};
    columns.forEach((col) => {
      initial[col.key] = col.width || 180;
    });
    setColWidths(initial);
  }, [columns]);

  // Handle column resize drag
  const startResize = (e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColRef.current = {
      colKey,
      startX: e.clientX,
      startWidth: colWidths[colKey] || 180,
    };

    const handleMouseMove = (moveEvent) => {
      if (!resizingColRef.current) return;
      const delta = moveEvent.clientX - resizingColRef.current.startX;
      const newWidth = Math.max(80, resizingColRef.current.startWidth + delta);
      setColWidths((prev) => ({
        ...prev,
        [resizingColRef.current.colKey]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      resizingColRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allIds = data.map((row) => row[primaryKey] || row.id);
      onSelectIds?.(allIds);
    } else {
      onSelectIds?.([]);
    }
  };

  const handleToggleRow = (rowId) => {
    if (selectedIds.includes(rowId)) {
      onSelectIds?.(selectedIds.filter((id) => id !== rowId));
    } else {
      onSelectIds?.([...selectedIds, rowId]);
    }
  };

  const renderCellContent = (row, col) => {
    const val = row[col.key];

    if (val === null || val === undefined) {
      return <span className="text-[var(--admin-text-low)]">—</span>;
    }

    // ID / Primary Key
    if (col.key === primaryKey || col.isId) {
      return (
        <span
          className="font-mono text-xs text-[var(--admin-accent-telemetry)] hover:underline cursor-pointer truncate block"
          title={String(val)}
          onClick={(e) => {
            e.stopPropagation();
            onRowClick?.(row);
          }}
        >
          {String(val)}
        </span>
      );
    }

    // Status or Role Enum
    if (
      col.key.toLowerCase().includes("status") ||
      col.key.toLowerCase().includes("role") ||
      col.type === "Enum"
    ) {
      return <StatusPill value={val} />;
    }

    // Date / Time
    if (col.type === "DateTime" || col.key.endsWith("At")) {
      return (
        <div
          className="flex items-center gap-1.5 font-mono text-xs text-[var(--admin-text-medium)] truncate"
          title={new Date(val).toISOString()}
        >
          <Clock size={11} className="text-[var(--admin-text-low)] flex-shrink-0" />
          <span>{formatTimeRelative(val)}</span>
        </div>
      );
    }

    // Boolean
    if (typeof val === "boolean" || col.type === "Boolean") {
      return val ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--admin-accent-primary)]">
          <Check size={12} />
          <span>TRUE</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--admin-text-low)]">
          <X size={12} />
          <span>FALSE</span>
        </span>
      );
    }

    // JSON object or Array
    if (typeof val === "object") {
      const isArr = Array.isArray(val);
      const count = isArr ? val.length : Object.keys(val).length;
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--admin-surface-overlay)] text-[var(--admin-accent-telemetry)] border border-[var(--admin-border-subtle)]">
          <Code size={10} />
          <span>{isArr ? `[${count}]` : `{${count}}`}</span>
        </span>
      );
    }

    // Numeric
    if (typeof val === "number" || col.type === "Int" || col.type === "Float") {
      return (
        <span className="font-mono text-xs tabular-nums text-[var(--admin-text-high)]">
          {val.toLocaleString()}
        </span>
      );
    }

    // Default string
    return (
      <span className="text-xs text-[var(--admin-text-high)] truncate block" title={String(val)}>
        {String(val)}
      </span>
    );
  };

  const isAllSelected = data.length > 0 && selectedIds.length === data.length;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden rounded-lg border border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)]">
      {/* Table Container */}
      <div className="flex-1 overflow-auto relative">
        <table className="w-full border-collapse text-left table-fixed">
          {/* Table Header */}
          <thead className="sticky top-0 z-20 bg-[var(--admin-surface-raised)] border-b border-[var(--admin-border-strong)] text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase tracking-wider select-none shadow-xs">
            <tr>
              {/* Checkbox Column */}
              <th className="w-10 px-3 py-2.5 text-center bg-[var(--admin-surface-raised)] sticky left-0 z-30 border-r border-[var(--admin-border-subtle)]">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleSelectAll}
                  className="rounded border-[var(--admin-border-strong)] bg-[var(--admin-surface-base)] text-[var(--admin-accent-primary)] focus:ring-0 cursor-pointer"
                />
              </th>

              {/* Dynamic Columns */}
              {columns.map((col) => {
                const isSorted = sortBy === col.key;
                const width = colWidths[col.key] || 180;

                return (
                  <th
                    key={col.key}
                    style={{ width }}
                    className="relative px-3 py-2.5 bg-[var(--admin-surface-raised)] border-r border-[var(--admin-border-subtle)] hover:text-[var(--admin-text-high)] transition-colors cursor-pointer"
                    onClick={() => {
                      const nextDir = isSorted && sortDir === "asc" ? "desc" : "asc";
                      onSortChange?.(col.key, nextDir);
                    }}
                  >
                    <div className="flex items-center justify-between gap-1 overflow-hidden">
                      <span className="truncate">{col.label || col.key}</span>
                      <div className="flex-shrink-0 text-[var(--admin-text-low)]">
                        {isSorted ? (
                          sortDir === "asc" ? (
                            <ChevronUp size={13} className="text-[var(--admin-accent-primary)]" />
                          ) : (
                            <ChevronDown size={13} className="text-[var(--admin-accent-primary)]" />
                          )
                        ) : (
                          <ChevronsUpDown size={11} />
                        )}
                      </div>
                    </div>

                    {/* Resizer handle */}
                    <div
                      onMouseDown={(e) => startResize(e, col.key)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-0 right-0 bottom-0 w-1.5 hover:bg-[var(--admin-accent-primary)] cursor-col-resize z-10 transition-colors"
                    />
                  </th>
                );
              })}

              {/* Actions Column */}
              <th className="w-20 px-3 py-2.5 text-right bg-[var(--admin-surface-raised)] sticky right-0 z-30 border-l border-[var(--admin-border-subtle)]">
                Actions
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-[var(--admin-border-subtle)]">
            {isLoading ? (
              // Loading Skeleton
              Array.from({ length: 8 }).map((_, rIdx) => (
                <tr key={`skel-${rIdx}`} className="animate-pulse">
                  <td className="px-3 py-3 sticky left-0 bg-[var(--admin-surface-base)] border-r border-[var(--admin-border-subtle)]">
                    <div className="w-4 h-4 bg-[var(--admin-surface-overlay)] rounded" />
                  </td>
                  {columns.map((col) => (
                    <td key={`skel-cell-${col.key}`} className="px-3 py-3 border-r border-[var(--admin-border-subtle)]">
                      <div className="h-3.5 bg-[var(--admin-surface-overlay)] rounded w-3/4" />
                    </td>
                  ))}
                  <td className="px-3 py-3 sticky right-0 bg-[var(--admin-surface-base)] border-l border-[var(--admin-border-subtle)]">
                    <div className="h-3.5 bg-[var(--admin-surface-overlay)] rounded w-8 ml-auto" />
                  </td>
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="py-16 text-center text-xs text-[var(--admin-text-medium)] bg-[var(--admin-surface-base)]"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Layers size={24} className="text-[var(--admin-text-low)]" />
                    <span>{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const rowId = row[primaryKey] || row.id;
                const isSelected = selectedIds.includes(rowId);

                return (
                  <tr
                    key={rowId}
                    onClick={() => onRowClick?.(row)}
                    className={`group transition-colors cursor-pointer text-xs ${
                      isSelected
                        ? "bg-[var(--admin-accent-primary-muted)]/60 hover:bg-[var(--admin-accent-primary-muted)]"
                        : "hover:bg-[var(--admin-surface-raised)]/70 bg-[var(--admin-surface-base)]"
                    }`}
                  >
                    {/* Row Checkbox */}
                    <td
                      onClick={(e) => e.stopPropagation()}
                      className={`px-3 py-2 text-center sticky left-0 z-10 border-r border-[var(--admin-border-subtle)] transition-colors ${
                        isSelected ? "bg-[var(--admin-surface-raised)]" : "bg-[var(--admin-surface-base)] group-hover:bg-[var(--admin-surface-raised)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleRow(rowId)}
                        className="rounded border-[var(--admin-border-strong)] bg-[var(--admin-surface-base)] text-[var(--admin-accent-primary)] focus:ring-0 cursor-pointer"
                      />
                    </td>

                    {/* Data Cells */}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className="px-3 py-2 border-r border-[var(--admin-border-subtle)] overflow-hidden"
                      >
                        {renderCellContent(row, col)}
                      </td>
                    ))}

                    {/* Actions Column */}
                    <td
                      onClick={(e) => e.stopPropagation()}
                      className={`px-3 py-2 text-right sticky right-0 z-10 border-l border-[var(--admin-border-subtle)] transition-colors ${
                        isSelected ? "bg-[var(--admin-surface-raised)]" : "bg-[var(--admin-surface-base)] group-hover:bg-[var(--admin-surface-raised)]"
                      }`}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onRowClick?.(row)}
                          className="p-1 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-accent-primary)] hover:bg-[var(--admin-surface-overlay)] transition-colors"
                          title="Inspect record"
                        >
                          <Eye size={13} />
                        </button>
                        {onDeleteRow && (
                          <button
                            type="button"
                            onClick={() => onDeleteRow?.(row)}
                            className="p-1 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-status-danger)] hover:bg-[var(--admin-surface-overlay)] transition-colors"
                            title="Delete record"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
