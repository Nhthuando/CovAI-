import { isKpiIncludedLifecycleStatus } from "../../../../shared/portfolioGovernance.js";

/**
 * Immutably patch a project (lifecycleStatus and/or isPinned) in the portfolio React Query cache.
 * When lifecycleStatus changes, clears stale server-computed aggregate fields so adaptPortfolioDashboard
 * immediately recalculates DOING-only KPIs until the background refetch finishes.
 */
export function applyProjectPatchToPortfolioCache(
  cacheData,
  projectId,
  patch = {},
) {
  if (!cacheData || !projectId || !patch || typeof patch !== "object") {
    return cacheData;
  }

  const hasLifecycle = patch.lifecycleStatus !== undefined && patch.lifecycleStatus !== null;
  const hasPinned = patch.isPinned !== undefined;
  if (!hasLifecycle && !hasPinned) return cacheData;

  const nowIso = new Date().toISOString();

  const patchProject = (p) => {
    if (p.id !== projectId) return p;
    return {
      ...p,
      ...(hasLifecycle && {
        lifecycleStatus: patch.lifecycleStatus,
        isExcludedFromActiveKpis: !isKpiIncludedLifecycleStatus(patch.lifecycleStatus),
        lifecycleUpdatedAt: nowIso,
      }),
      ...(hasPinned && {
        isPinned: Boolean(patch.isPinned),
      }),
    };
  };

  if (Array.isArray(cacheData.projects)) {
    const idx = cacheData.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return cacheData;

    const updatedProjects = cacheData.projects.map(patchProject);
    return {
      ...cacheData,
      projects: updatedProjects,
      ...(hasLifecycle && {
        activeKpis: null,
        analytics: null,
        timeRoiAnalytics: null,
        lifecycleCounts: null,
        activeProjectsCount: undefined,
      }),
    };
  }

  if (Array.isArray(cacheData.data?.projects)) {
    const idx = cacheData.data.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return cacheData;

    const updatedProjects = cacheData.data.projects.map(patchProject);
    return {
      ...cacheData,
      data: {
        ...cacheData.data,
        projects: updatedProjects,
        ...(hasLifecycle && {
          activeKpis: null,
          analytics: null,
          timeRoiAnalytics: null,
          lifecycleCounts: null,
          activeProjectsCount: undefined,
        }),
      },
    };
  }

  return cacheData;
}

/**
 * Immutably update a project's lifecycleStatus in the portfolio React Query cache.
 */
export function applyLifecycleStatusToPortfolioCache(
  cacheData,
  projectId,
  lifecycleStatus,
) {
  if (!cacheData || !projectId || !lifecycleStatus) return cacheData;
  return applyProjectPatchToPortfolioCache(cacheData, projectId, {
    lifecycleStatus,
  });
}

/**
 * Immutably patch a project (lifecycleStatus and/or isPinned) in a ["projects"] React Query list.
 */
export function applyProjectPatchToProjectsList(
  projectsList,
  projectId,
  patch = {},
) {
  if (!projectsList || !projectId || !patch || typeof patch !== "object") {
    return projectsList;
  }

  const hasLifecycle = patch.lifecycleStatus !== undefined && patch.lifecycleStatus !== null;
  const hasPinned = patch.isPinned !== undefined;
  if (!hasLifecycle && !hasPinned) return projectsList;

  const patchItem = (p) =>
    p.id === projectId
      ? {
          ...p,
          ...(hasLifecycle && {
            lifecycleStatus: patch.lifecycleStatus,
            isExcludedFromActiveKpis: !isKpiIncludedLifecycleStatus(patch.lifecycleStatus),
          }),
          ...(hasPinned && {
            isPinned: Boolean(patch.isPinned),
          }),
        }
      : p;

  if (Array.isArray(projectsList)) {
    const idx = projectsList.findIndex((p) => p.id === projectId);
    if (idx === -1) return projectsList;
    return projectsList.map(patchItem);
  }

  if (Array.isArray(projectsList?.projects)) {
    const idx = projectsList.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return projectsList;
    return {
      ...projectsList,
      projects: projectsList.projects.map(patchItem),
    };
  }

  return projectsList;
}

/**
 * Immutably update a project's lifecycleStatus in a flat ["projects"] React Query array.
 */
export function applyLifecycleStatusToProjectsList(
  projectsList,
  projectId,
  lifecycleStatus,
) {
  if (!Array.isArray(projectsList) || !projectId || !lifecycleStatus) {
    return projectsList;
  }
  return applyProjectPatchToProjectsList(projectsList, projectId, {
    lifecycleStatus,
  });
}

/**
 * Immutably remove a deleted project from the portfolio React Query cache.
 */
export function removeProjectFromPortfolioCache(cacheData, projectId) {
  if (!cacheData || !projectId) return cacheData;

  if (Array.isArray(cacheData.projects)) {
    const projects = cacheData.projects.filter((p) => p.id !== projectId);
    if (projects.length === cacheData.projects.length) return cacheData;
    return {
      ...cacheData,
      projects,
      activeKpis: null,
      analytics: null,
      timeRoiAnalytics: null,
      lifecycleCounts: null,
      activeProjectsCount: undefined,
    };
  }

  if (Array.isArray(cacheData.data?.projects)) {
    const projects = cacheData.data.projects.filter((p) => p.id !== projectId);
    if (projects.length === cacheData.data.projects.length) return cacheData;
    return {
      ...cacheData,
      data: {
        ...cacheData.data,
        projects,
        activeKpis: null,
        analytics: null,
        timeRoiAnalytics: null,
        lifecycleCounts: null,
        activeProjectsCount: undefined,
      },
    };
  }

  return cacheData;
}

/**
 * Immutably remove a deleted project from a flat ["projects"] React Query list.
 */
export function removeProjectFromProjectsList(projectsList, projectId) {
  if (!projectId) return projectsList;
  if (Array.isArray(projectsList)) {
    return projectsList.filter((p) => p.id !== projectId);
  }
  if (Array.isArray(projectsList?.projects)) {
    return {
      ...projectsList,
      projects: projectsList.projects.filter((p) => p.id !== projectId),
    };
  }
  return projectsList;
}
