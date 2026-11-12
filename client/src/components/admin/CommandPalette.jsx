import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Database,
  Users,
  Cpu,
  Layers,
  Activity,
  FileText,
  RotateCcw,
  Trash2,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from "lucide-react";

/**
 * CommandPalette — ⌘K / Ctrl+K Quick Action Hub
 * Rapid search across 67 models, admin tools, and system controls.
 */
export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  tables = [], // [{ name, count, domain, primaryKey }]
  onQuickAction = null,
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // Core navigation items
  const staticNavigation = [
    { id: "dash", title: "Mission Control Dashboard", section: "Navigation", icon: Activity, path: "/admin" },
    { id: "db", title: "Database Universal Explorer (67 Models)", section: "Navigation", icon: Database, path: "/admin/database" },
    { id: "users", title: "User & Access Governance", section: "Navigation", icon: Users, path: "/admin/users" },
    { id: "ai", title: "AI & Gemini LLM Observability", section: "Navigation", icon: Cpu, path: "/admin/ai" },
    { id: "queues", title: "BullMQ Job & Worker Console", section: "Navigation", icon: Layers, path: "/admin/queues" },
    { id: "health", title: "System Health & Infrastructure Telemetry", section: "Navigation", icon: Activity, path: "/admin/health" },
    { id: "audit", title: "Immutable Audit Log Trail", section: "Navigation", icon: FileText, path: "/admin/audit" },
  ];

  // Quick Action triggers
  const quickActions = [
    { id: "qa-retry-jobs", title: "Retry All Failed BullMQ Jobs", section: "Quick Action", icon: RotateCcw, actionKey: "RETRY_JOBS" },
    { id: "qa-cleanup-temp", title: "Clean Up Temp Workspace Files (.covai-temp)", section: "Quick Action", icon: Trash2, actionKey: "CLEANUP_TEMP" },
    { id: "qa-refresh-schema", title: "Introspect Prisma DMMF Schema", section: "Quick Action", icon: Sparkles, actionKey: "REFRESH_SCHEMA" },
  ];

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Compute matched items
  const cleanQ = query.trim().toLowerCase();

  const filteredNav = staticNavigation.filter((item) =>
    item.title.toLowerCase().includes(cleanQ)
  );

  const filteredActions = quickActions.filter((item) =>
    item.title.toLowerCase().includes(cleanQ)
  );

  const filteredTables = (tables || [])
    .filter((t) => t.name.toLowerCase().includes(cleanQ) || (t.domain && t.domain.toLowerCase().includes(cleanQ)))
    .slice(0, 25)
    .map((t) => ({
      id: `table-${t.name}`,
      title: `${t.name}`,
      meta: `${t.domain || "Database"} · ${t.count ?? 0} records`,
      section: "Database Models",
      icon: Database,
      tableName: t.name,
    }));

  const allItems = [...filteredNav, ...filteredActions, ...filteredTables];

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (allItems.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + (allItems.length || 1)) % (allItems.length || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = allItems[selectedIndex];
      if (!chosen) return;

      if (chosen.path) {
        onNavigate?.(chosen.path);
        onClose();
      } else if (chosen.tableName) {
        onNavigate?.(`/admin/database?table=${chosen.tableName}`);
        onClose();
      } else if (chosen.actionKey) {
        onQuickAction?.(chosen.actionKey);
        onClose();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--admin-border-subtle)] bg-[var(--admin-surface-overlay)]">
          <Search size={18} className="text-[var(--admin-text-medium)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a table name, navigation route or command..."
            className="w-full bg-transparent text-sm text-[var(--admin-text-high)] placeholder-[var(--admin-text-low)] focus:outline-none font-sans"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {allItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--admin-text-medium)]">
              No matching tables or commands found for "{query}"
            </div>
          ) : (
            allItems.map((item, idx) => {
              const Icon = item.icon || Database;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.path) {
                      onNavigate?.(item.path);
                    } else if (item.tableName) {
                      onNavigate?.(`/admin/database?table=${item.tableName}`);
                    } else if (item.actionKey) {
                      onQuickAction?.(item.actionKey);
                    }
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors text-xs ${
                    isSelected
                      ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]"
                      : "text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-1.5 rounded-md ${
                        isSelected
                          ? "bg-[var(--admin-accent-primary)] text-black"
                          : "bg-[var(--admin-surface-base)] text-[var(--admin-text-medium)]"
                      }`}
                    >
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{item.title}</div>
                      {item.meta && (
                        <div className="text-[11px] text-[var(--admin-text-medium)] font-mono">
                          {item.meta}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-[var(--admin-text-low)] uppercase tracking-wider">
                    <span>{item.section}</span>
                    <ChevronRight size={12} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)] text-[11px] text-[var(--admin-text-low)]">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span className="font-mono text-[10px] text-[var(--admin-accent-primary)]">
            CovAI Mission Control ⌘K
          </span>
        </div>
      </div>
    </div>
  );
}
