import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  Users,
  Cpu,
  Layers,
  Activity,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  LogOut,
  Shield,
  Radio,
  Menu,
  X,
  RefreshCw,
  FolderKanban,
} from "lucide-react";
import { CommandPalette } from "./CommandPalette.jsx";
import { adminService } from "../../services/admin.service.js";
import { useAdminSocket } from "../../hooks/useAdminSocket.js";
import { useAuth } from "../../hooks/useAuth.js";

/**
 * Navigation routes
 */
const MAIN_NAV_ITEMS = [
  { path: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { path: "/admin/database", label: "Database Explorer", icon: Database },
  { path: "/admin/users", label: "User Governance", icon: Users },
  { path: "/admin/ai", label: "Gemini AI Observability", icon: Cpu },
  { path: "/admin/queues", label: "BullMQ Queues", icon: Layers },
  { path: "/admin/health", label: "System Health", icon: Activity },
  { path: "/admin/audit", label: "Audit Logs", icon: FileText },
];

/**
 * AdminLayout — Mission Control Shell
 */
export function AdminLayout({ children, user = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleExitAdmin = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [schemaData, setSchemaData] = useState(null);
  const [collapsedDomains, setCollapsedDomains] = useState({});

  // Real-time telemetry via WebSocket
  const { isConnected, pulseLatency, alerts, dismissAlert } = useAdminSocket();

  // Load schema metadata and table counts
  useEffect(() => {
    let isMounted = true;

    async function loadSchema() {
      try {
        const schema = await adminService.getSchema();
        if (isMounted) setSchemaData(schema);
      } catch (err) {
        console.warn("[AdminLayout] Failed to load schema metadata:", err.message);
      }
    }

    loadSchema();
    return () => {
      isMounted = false;
    };
  }, []);

  // Keyboard shortcut for Command Palette (⌘K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleDomain = (domainKey) => {
    setCollapsedDomains((prev) => ({
      ...prev,
      [domainKey]: !prev[domainKey],
    }));
  };

  const domainGroups = schemaData?.domainGroups || {};

  // Flatten all tables for CommandPalette
  const allTablesList = [];
  Object.entries(domainGroups).forEach(([domain, tables]) => {
    tables.forEach((t) => {
      allTablesList.push({
        name: t.name,
        count: t.count,
        domain: domain,
        primaryKey: t.primaryKey,
      });
    });
  });

  const currentUserRole = user?.systemRole || "ADMIN";
  const userEmail = user?.email || "admin@covai.dev";

  return (
    <div className="admin-scope flex flex-col h-screen w-screen overflow-hidden select-none bg-[var(--admin-bg-void)] text-[var(--admin-text-high)]">
      {/* ============================================================
          1. TOPBAR TÁC CHIẾN (MISSION BAR - 48px)
          ============================================================ */}
      <header className="h-12 border-b border-[var(--admin-border-subtle)] bg-[var(--admin-surface-raised)] flex items-center justify-between px-4 z-30 flex-shrink-0">
        {/* Brand & Environment */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] transition-colors"
            title="Toggle Sidebar"
          >
            {isSidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>

          <Link to="/admin" className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--admin-accent-primary)] shadow-[0_0_8px_rgba(0,229,153,0.8)] admin-live-pulse" />
            <span className="font-bold text-sm tracking-wider text-[var(--admin-text-high)]">
              CovAI <span className="text-[var(--admin-accent-primary)] font-mono">ADMIN</span>
            </span>
          </Link>

          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] border border-[var(--admin-status-danger)]/40">
            PROD
          </span>
        </div>

        {/* Command Palette Trigger */}
        <div className="flex-1 max-w-md mx-4">
          <button
            type="button"
            onClick={() => setIsPaletteOpen(true)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-md bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] hover:border-[var(--admin-accent-primary)] text-xs text-[var(--admin-text-medium)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Search size={13} className="text-[var(--admin-text-low)]" />
              <span>Search 67 tables, queues, actions...</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Telemetry Pulse, User & Actions */}
        <div className="flex items-center gap-3">
          {/* Live Pulse */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[11px] font-mono">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? "bg-[var(--admin-accent-primary)] shadow-[0_0_6px_rgba(0,229,153,0.8)]" : "bg-[var(--admin-status-warning)]"
              } admin-live-pulse`}
            />
            <span className="text-[var(--admin-text-medium)]">Pulse:</span>
            <span
              className={`tabular-nums ${
                isConnected ? "text-[var(--admin-accent-primary)] font-bold" : "text-[var(--admin-status-warning)]"
              }`}
            >
              {isConnected ? `${pulseLatency}ms` : "OFFLINE"}
            </span>
          </div>

          {/* User Role Badge */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]">
            <Shield size={12} className="text-[var(--admin-accent-primary)]" />
            <span className="text-xs font-mono font-semibold text-[var(--admin-text-high)]">
              {currentUserRole}
            </span>
          </div>

          {/* Link back to Workspace without logging out */}
          <Link
            to="/projects"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-subtle)] transition-colors admin-tactile-btn"
            title="Switch to Projects Workspace"
          >
            <FolderKanban size={13} />
            <span className="hidden sm:inline">Workspace</span>
          </Link>

          {/* Exit Admin & Log Out to /login */}
          <button
            type="button"
            onClick={handleExitAdmin}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded text-[var(--admin-status-danger)] hover:bg-[var(--admin-status-danger-muted)] border border-[var(--admin-status-danger)]/40 transition-colors admin-tactile-btn cursor-pointer"
            title="Log Out and return to Login"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Exit Admin</span>
          </button>
        </div>
      </header>

      {/* Real-time System Broadcast Alerts Banner */}
      {alerts && alerts.length > 0 && (
        <div className="bg-[var(--admin-status-danger-muted)] border-b border-[var(--admin-status-danger)]/40 px-4 py-2 flex items-center justify-between text-xs text-[var(--admin-status-danger)] font-mono z-20 flex-shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="w-2 h-2 rounded-full bg-[var(--admin-status-danger)] admin-live-pulse flex-shrink-0" />
            <span className="font-bold flex-shrink-0">SYSTEM BROADCAST:</span>
            <span className="truncate">{alerts[0].message}</span>
          </div>
          <button
            type="button"
            onClick={() => dismissAlert(alerts[0].id)}
            className="text-[11px] underline hover:text-white cursor-pointer ml-3 flex-shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ============================================================
          2. MAIN BODY (SIDEBAR + CONTENT CANVAS)
          ============================================================ */}
      <div className="flex-1 flex overflow-hidden">
        {/* SIDEBAR */}
        {isSidebarOpen && (
          <aside className="w-64 border-r border-[var(--admin-border-subtle)] bg-[var(--admin-surface-raised)] flex flex-col flex-shrink-0 overflow-hidden">
            {/* Top Navigation Links */}
            <div className="p-3 border-b border-[var(--admin-border-subtle)] space-y-1">
              {MAIN_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.path === "/admin"
                    ? location.pathname === "/admin"
                    : location.pathname.startsWith(item.path);

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]"
                        : "text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] border border-transparent"
                    }`}
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Quick Filter Tables Input */}
            <div className="p-2 border-b border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)]">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2 text-[var(--admin-text-low)]" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Filter 67 tables..."
                  className="w-full pl-7 pr-2 py-1 text-[11px] font-mono rounded bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)]"
                />
              </div>
            </div>

            {/* 8 Domains Accordion */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--admin-text-low)] font-bold">
                Universal Database ({schemaData?.totalTables || 67} Tables)
              </div>

              {Object.entries(domainGroups).map(([domain, tables]) => {
                const isCollapsed = !!collapsedDomains[domain];
                const filtered = tables.filter((t) =>
                  t.name.toLowerCase().includes(tableSearch.trim().toLowerCase())
                );

                if (filtered.length === 0 && tableSearch.trim()) return null;

                return (
                  <div key={domain} className="space-y-0.5">
                    {/* Domain Header */}
                    <button
                      type="button"
                      onClick={() => toggleDomain(domain)}
                      className="w-full flex items-center justify-between px-2 py-1 rounded text-[11px] font-semibold text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] transition-colors"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <span className="truncate">{domain}</span>
                      </div>
                      <span className="text-[10px] font-mono px-1 rounded bg-[var(--admin-surface-base)] text-[var(--admin-text-low)] border border-[var(--admin-border-subtle)]">
                        {tables.length}
                      </span>
                    </button>

                    {/* Table List Under Domain */}
                    {!isCollapsed && (
                      <div className="pl-4 space-y-0.5 border-l border-[var(--admin-border-subtle)] ml-2.5">
                        {filtered.map((t) => {
                          const isTableActive =
                            location.pathname === "/admin/database" &&
                            new URLSearchParams(location.search).get("table") === t.name;

                          return (
                            <Link
                              key={t.name}
                              to={`/admin/database?table=${t.name}`}
                              className={`flex items-center justify-between px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                                isTableActive
                                  ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] font-bold"
                                  : "text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)]"
                              }`}
                            >
                              <span className="truncate">{t.name}</span>
                              <span className="text-[10px] text-[var(--admin-text-low)] tabular-nums ml-1">
                                {t.count !== undefined ? t.count : "—"}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Sidebar Footer info */}
            <div className="p-3 border-t border-[var(--admin-border-subtle)] bg-[var(--admin-surface-overlay)] text-[11px] flex items-center justify-between">
              <span className="text-[var(--admin-text-low)] font-mono text-[10px]">
                CovAI v2.0 Enterprise
              </span>
              <span className="w-2 h-2 rounded-full bg-[var(--admin-accent-primary)]" />
            </div>
          </aside>
        )}

        {/* MAIN CANVAS */}
        <main className="flex-1 overflow-auto bg-[var(--admin-surface-base)] relative">
          {children}
        </main>
      </div>

      {/* Global Command Palette Modal */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        tables={allTablesList}
        onNavigate={(path) => navigate(path)}
        onQuickAction={async (actionKey) => {
          if (actionKey === "RETRY_JOBS") {
            try {
              await adminService.retryAllFailedJobs("covai-jobs-main");
              alert("Triggered retry for all failed jobs.");
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          } else if (actionKey === "CLEANUP_TEMP") {
            try {
              const res = await adminService.cleanupTempWorkspace(2);
              alert(`Cleaned up ${res.cleanedFolders} temporary folders.`);
            } catch (err) {
              alert(`Error: ${err.message}`);
            }
          }
        }}
      />
    </div>
  );
}
