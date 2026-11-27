import {
  PROJECT_LIFECYCLE_STATES,
  LIFECYCLE_META,
  canManageProjectLifecycle,
  validateLifecycleTransition,
} from "../../../../../shared/portfolioGovernance.js";

/**
 * Returns true only when the workspace topbar should display a subtle static badge
 * warning that the current project is isolated from Portfolio Active KPIs.
 */
export function shouldShowTopbarLifecycleBadge(lifecycleStatus) {
  if (!lifecycleStatus) return false;
  return Boolean(LIFECYCLE_META[lifecycleStatus]?.showTopbarIsolatedBadge);
}

/**
 * Determine whether a project already has executed test runs, coverage, or snapshot history.
 */
export function resolveProjectHasActivity(project = null, unifiedSummary = null) {
  if (!project && !unifiedSummary) return false;
  if (project?.hasLifecycleActivity) return true;

  const pPillars = project?.pillars || {};
  const uPillars = unifiedSummary?.pillars || {};

  const portfolioTests =
    (Number(pPillars.unit?.totalTests) || 0) +
    (Number(pPillars.integration?.totalTests) || 0) +
    (Number(pPillars.system?.totalTests) || 0);
  if (portfolioTests > 0) return true;

  const summaryTests =
    (Number(uPillars.unit?.totalTests) || 0) +
    (Number(uPillars.integration?.totalTests) || 0) +
    (Number(uPillars.system?.totalTests) || 0) +
    (Number(unifiedSummary?.totalTests) || 0);
  if (summaryTests > 0) return true;

  if (project?.gateStatus && project.gateStatus !== "UNTESTED") return true;
  if (project?.healthScore !== null && project?.healthScore !== undefined) return true;
  if ((Number(project?.snapshotVersion) || 0) > 1) return true;
  if ((Number(project?._count?.snapshots) || 0) > 1) return true;

  return false;
}

/**
 * Build RBAC & transition guard view-model for ProjectLifecycleEditor.
 */
export function resolveLifecycleEditorState({
  currentStatus = "NOT_STARTED",
  currentUserRole = null,
  canManageLifecycle = undefined,
  hasActivity = false,
} = {}) {
  const canEdit =
    canManageLifecycle !== undefined
      ? Boolean(canManageLifecycle)
      : canManageProjectLifecycle(currentUserRole);

  const readOnlyReason = canEdit
    ? null
    : "Only the project owner can change lifecycle state or repository pin.";

  const options = PROJECT_LIFECYCLE_STATES.map((state) => {
    const meta = LIFECYCLE_META[state];
    const transition = validateLifecycleTransition({
      currentStatus,
      nextStatus: state,
      hasActivity,
    });

    const isCurrent = currentStatus === state;
    const transitionBlocked = !transition.allowed;

    return {
      value: state,
      label: meta.label,
      description: meta.description,
      includedInKpis: meta.includedInKpis,
      isCurrent,
      disabled: !canEdit || (transitionBlocked && !isCurrent),
      disabledReason: !canEdit
        ? readOnlyReason
        : transitionBlocked && !isCurrent
          ? transition.reason
          : null,
      validationCode: transition.code,
    };
  });

  return {
    canEdit,
    readOnlyReason,
    options,
  };
}

/**
 * Map API mutation errors into concise UI messages.
 */
export function formatLifecycleMutationError(err) {
  if (
    err?.code === "CANNOT_REVERT_TO_NOT_STARTED" ||
    err?.status === 409
  ) {
    return "This project already has test or coverage history and cannot be reverted to Not Started. Choose Paused or Completed instead.";
  }
  if (err?.status === 403) {
    return "Permission denied. Only the project Owner can update lifecycle settings.";
  }
  return err?.message || "Failed to update project lifecycle settings.";
}
