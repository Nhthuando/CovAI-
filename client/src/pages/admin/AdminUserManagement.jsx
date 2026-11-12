import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  Search,
  Filter,
  Shield,
  ShieldAlert,
  Ban,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Key,
  FolderGit2,
} from "lucide-react";
import { adminService } from "../../services/admin.service.js";
import { SYSTEM_ROLES } from "../../shared/adminRoles.js";

/**
 * AdminUserManagement — User & Access Governance View
 */
export default function AdminUserManagement() {
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Modals state
  const [selectedUser, setSelectedUser] = useState(null);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [newRole, setNewRole] = useState("USER");
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [extraTokens, setExtraTokens] = useState(10000);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchUsers = useCallback(async (pageToLoad = meta.page) => {
    setIsLoading(true);
    try {
      const res = await adminService.listUsers({
        page: pageToLoad,
        limit: meta.limit,
        q: searchQuery || undefined,
        role: roleFilter || undefined,
        suspended: statusFilter === "" ? undefined : statusFilter === "suspended",
      });
      setUsers(res.users || []);
      setMeta(res.meta || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (err) {
      console.error("[AdminUserManagement] Error loading users:", err);
    } finally {
      setIsLoading(false);
    }
  }, [meta.limit, meta.page, searchQuery, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers(1);
  }, [roleFilter, statusFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchUsers(1);
  };

  // Toggle user suspension
  const handleToggleSuspend = async (user) => {
    const nextStatus = !user.isSuspended;
    const confirmMsg = nextStatus
      ? `Are you sure you want to SUSPEND ${user.email}? They will be immediately blocked from accessing the system.`
      : `Activate account for ${user.email}?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await adminService.updateUserStatus(user.id, nextStatus, nextStatus ? "Admin manual suspension" : "Admin activated");
      fetchUsers();
    } catch (err) {
      alert(`Failed to update user status: ${err.message}`);
    }
  };

  // Save new role
  const handleSaveRole = async () => {
    if (!selectedUser) return;
    setIsUpdating(true);
    try {
      await adminService.updateUserRole(selectedUser.id, newRole);
      setIsRoleModalOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      alert(`Failed to change role: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Reset Quota
  const handleResetQuota = async () => {
    if (!selectedUser) return;
    setIsUpdating(true);
    try {
      await adminService.resetUserQuota(selectedUser.id, {
        resetDailyCount: true,
        extraTokens: parseInt(extraTokens, 10) || 0,
      });
      setIsQuotaModalOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      alert(`Failed to reset quota: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col space-y-4 max-w-[1600px] mx-auto overflow-hidden">
      {/* 1. Header & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--admin-border-subtle)] flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--admin-text-high)]">
              User & Access Governance
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] text-[var(--admin-accent-telemetry)]">
              {meta.total} Accounts
            </span>
          </div>
          <p className="text-xs text-[var(--admin-text-medium)] mt-1">
            Manage system roles, account active/suspended statuses, project quotas, and token allowances.
          </p>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <form onSubmit={handleSearch} className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--admin-text-low)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search email or name..."
              className="pl-8 pr-3 py-1.5 text-xs font-mono rounded bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)] w-48 sm:w-60"
            />
          </form>

          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] font-mono focus:outline-none"
          >
            <option value="">All Roles</option>
            <option value="SUPERADMIN">SUPERADMIN</option>
            <option value="ADMIN">ADMIN</option>
            <option value="OPERATOR">OPERATOR</option>
            <option value="USER">USER</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] font-mono focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="suspended">Suspended Only</option>
          </select>

          <button
            type="button"
            onClick={() => fetchUsers()}
            disabled={isLoading}
            className="p-2 rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] border border-[var(--admin-border-subtle)] transition-colors"
            title="Refresh Users"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 2. User Table Display */}
      <div className="flex-1 overflow-auto rounded-lg border border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)] relative">
        <table className="w-full border-collapse text-left text-xs table-fixed">
          <thead className="sticky top-0 z-10 bg-[var(--admin-surface-raised)] border-b border-[var(--admin-border-strong)] text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase tracking-wider font-mono">
            <tr>
              <th className="py-2.5 px-4 w-[240px]">User & Identity</th>
              <th className="py-2.5 px-3 w-[140px]">System Role</th>
              <th className="py-2.5 px-3 w-[120px]">Account Status</th>
              <th className="py-2.5 px-3 w-[100px] text-right">Projects</th>
              <th className="py-2.5 px-3 w-[100px] text-right">Jobs Run</th>
              <th className="py-2.5 px-3 w-[140px] text-right">AI Token Usage</th>
              <th className="py-2.5 px-4 w-[140px]">Created At</th>
              <th className="py-2.5 px-4 w-[160px] text-right">Governance Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border-subtle)]">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <tr key={`skel-${idx}`} className="animate-pulse">
                  <td colSpan={8} className="py-4 px-4 bg-[var(--admin-surface-base)]">
                    <div className="h-4 bg-[var(--admin-surface-overlay)] rounded w-full" />
                  </td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-xs text-[var(--admin-text-medium)]">
                  No user accounts found matching your filters.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSuperAdmin = u.systemRole === "SUPERADMIN";

                return (
                  <tr key={u.id} className="hover:bg-[var(--admin-surface-raised)]/60 transition-colors">
                    {/* User Identity */}
                    <td className="py-2.5 px-4 overflow-hidden">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-strong)] flex items-center justify-center font-bold text-xs text-[var(--admin-accent-primary)] flex-shrink-0">
                          {u.name ? u.name.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--admin-text-high)] truncate">
                            {u.name || "Unnamed User"}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--admin-text-medium)] truncate">
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Role Badge */}
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${
                          isSuperAdmin
                            ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border-[var(--admin-border-accent)]"
                            : u.systemRole === "ADMIN"
                            ? "bg-[var(--admin-accent-telemetry-muted)] text-[var(--admin-accent-telemetry)] border-[var(--admin-accent-telemetry)]/30"
                            : u.systemRole === "OPERATOR"
                            ? "bg-[var(--admin-status-warning-muted)] text-[var(--admin-status-warning)] border-[var(--admin-status-warning)]/30"
                            : "bg-[var(--admin-surface-overlay)] text-[var(--admin-text-medium)] border-[var(--admin-border-subtle)]"
                        }`}
                      >
                        <Shield size={11} />
                        <span>{u.systemRole}</span>
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3">
                      {u.isSuspended ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] border border-[var(--admin-status-danger)]/40">
                          <Ban size={10} />
                          <span>SUSPENDED</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]">
                          <CheckCircle2 size={10} />
                          <span>ACTIVE</span>
                        </span>
                      )}
                    </td>

                    {/* Projects Count */}
                    <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[var(--admin-text-high)]">
                      {u._count?.projects || 0}
                    </td>

                    {/* Jobs Count */}
                    <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[var(--admin-text-medium)]">
                      {u._count?.jobs || 0}
                    </td>

                    {/* Token Usage */}
                    <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[var(--admin-accent-telemetry)] font-bold">
                      {(u.aiTokenUsage || 0).toLocaleString()}
                    </td>

                    {/* Created At */}
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[var(--admin-text-medium)]">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Change Role Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedUser(u);
                            setNewRole(u.systemRole);
                            setIsRoleModalOpen(true);
                          }}
                          className="p-1.5 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-accent-primary)] hover:bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-subtle)] transition-colors"
                          title="Change Role"
                        >
                          <Key size={12} />
                        </button>

                        {/* Reset Quota Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedUser(u);
                            setExtraTokens(10000);
                            setIsQuotaModalOpen(true);
                          }}
                          className="p-1.5 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-accent-telemetry)] hover:bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-subtle)] transition-colors"
                          title="Grant Tokens / Reset Daily Quota"
                        >
                          <RotateCcw size={12} />
                        </button>

                        {/* Suspend / Unsuspend */}
                        <button
                          type="button"
                          onClick={() => handleToggleSuspend(u)}
                          className={`p-1.5 rounded border transition-colors ${
                            u.isSuspended
                              ? "text-[var(--admin-accent-primary)] hover:bg-[var(--admin-accent-primary-muted)] border-[var(--admin-border-accent)]"
                              : "text-[var(--admin-status-danger)] hover:bg-[var(--admin-status-danger-muted)] border-[var(--admin-status-danger)]/40"
                          }`}
                          title={u.isSuspended ? "Activate Account" : "Suspend Account"}
                        >
                          <Ban size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Pagination Footer */}
      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] text-xs flex-shrink-0">
        <div className="flex items-center gap-3 text-[var(--admin-text-medium)] font-mono text-[11px]">
          <span>
            Page <span className="text-[var(--admin-text-high)] font-bold">{meta.page}</span> of{" "}
            <span className="text-[var(--admin-text-high)] font-bold">{meta.totalPages}</span>
          </span>
          <span>·</span>
          <span>
            Total: <span className="text-[var(--admin-accent-primary)] font-bold">{meta.total}</span> users
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={meta.page <= 1 || isLoading}
            onClick={() => fetchUsers(meta.page - 1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={13} />
            <span>Prev</span>
          </button>
          <button
            type="button"
            disabled={meta.page >= meta.totalPages || isLoading}
            onClick={() => fetchUsers(meta.page + 1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span>Next</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* 4. Change Role Modal */}
      {isRoleModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--admin-text-high)]">
              <Key size={16} className="text-[var(--admin-accent-primary)]" />
              <span>Change System Role</span>
            </div>
            <p className="text-xs text-[var(--admin-text-medium)]">
              Assign administrative permission tier for <span className="font-mono text-[var(--admin-text-high)]">{selectedUser.email}</span>.
            </p>

            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)]"
            >
              <option value="USER">USER (Regular User)</option>
              <option value="OPERATOR">OPERATOR (Monitoring & Queues)</option>
              <option value="ADMIN">ADMIN (Full Data Management)</option>
              <option value="SUPERADMIN">SUPERADMIN (System Governance)</option>
            </select>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--admin-border-subtle)]">
              <button
                type="button"
                onClick={() => setIsRoleModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded text-[var(--admin-text-medium)] hover:bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleSaveRole}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-[var(--admin-accent-primary)] text-black hover:bg-[var(--admin-accent-primary-hover)] transition-colors admin-tactile-btn"
              >
                {isUpdating ? "Saving..." : "Update Role"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Reset Quota Modal */}
      {isQuotaModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--admin-text-high)]">
              <RotateCcw size={16} className="text-[var(--admin-accent-telemetry)]" />
              <span>Reset Daily Quota & Grant Tokens</span>
            </div>
            <p className="text-xs text-[var(--admin-text-medium)]">
              Clear daily AI usage limit and credit tokens to <span className="font-mono text-[var(--admin-text-high)]">{selectedUser.email}</span>.
            </p>

            <div className="space-y-1">
              <label className="text-xs text-[var(--admin-text-medium)]">Extra Tokens Credit</label>
              <input
                type="number"
                value={extraTokens}
                onChange={(e) => setExtraTokens(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--admin-border-subtle)]">
              <button
                type="button"
                onClick={() => setIsQuotaModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded text-[var(--admin-text-medium)] hover:bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleResetQuota}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-[var(--admin-accent-primary)] text-black hover:bg-[var(--admin-accent-primary-hover)] transition-colors admin-tactile-btn"
              >
                {isUpdating ? "Processing..." : "Apply Credit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
