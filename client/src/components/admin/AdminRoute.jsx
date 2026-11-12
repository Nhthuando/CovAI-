import React from "react";
import { Navigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { AdminLayout } from "./AdminLayout.jsx";
import { isAdminRole } from "../../shared/adminRoles.js";

/**
 * AdminRoute — Security Gate for Admin Console
 * Restricts access to users with SUPERADMIN, ADMIN, or OPERATOR roles.
 */
export function AdminRoute({ children }) {
  const { user, isLoading } = useAuth();

  const token =
    localStorage.getItem("token") ||
    (localStorage.getItem("user")
      ? JSON.parse(localStorage.getItem("user")).token
      : null);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // If auth is still loading user profile
  if (isLoading) {
    return (
      <div className="admin-scope flex items-center justify-center h-screen w-screen bg-[var(--admin-bg-void)] text-[var(--admin-accent-primary)] font-mono text-sm">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--admin-accent-primary)] admin-live-pulse" />
          <span>Verifying Admin Authorization...</span>
        </div>
      </div>
    );
  }

  // Verify administrative role
  const userRole = user?.systemRole;
  if (!isAdminRole(userRole)) {
    console.warn(`[AdminRoute] Access denied: User ${user?.email || "unknown"} with role ${userRole} is not an administrator.`);
    return (
      <div className="admin-scope flex flex-col items-center justify-center h-screen w-screen bg-[#07090D] text-[#F8FAFC] p-6 font-mono text-center select-none">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4 text-red-400">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-lg font-bold tracking-wider text-red-400 mb-2">403 — ACCESS RESTRICTED</h1>
        <p className="text-xs text-neutral-400 max-w-md mb-6 leading-relaxed">
          The CovAI Mission Control Console is strictly reserved for platform administrators (SUPERADMIN, ADMIN, OPERATOR). Your current account ({user?.email || "unknown"}) has role <span className="text-amber-400 font-bold">{userRole || "USER"}</span>.
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/projects";
          }}
          className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-semibold text-white transition-colors cursor-pointer"
        >
          Return to Workspace
        </button>
      </div>
    );
  }

  return <AdminLayout user={user}>{children}</AdminLayout>;
}
