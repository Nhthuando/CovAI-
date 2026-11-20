/**
 * Immutably update a project's lifecycleStatus in the portfolio React Query cache.
 */
export function applyLifecycleStatusToPortfolioCache(
  cacheData,
  projectId,
  lifecycleStatus,
) {
  if (!cacheData || !projectId || !lifecycleStatus) return cacheData;

  const isExcluded = lifecycleStatus !== "DOING";
  const nowIso = new Date().toISOString();

  if (Array.isArray(cacheData.projects)) {
    const idx = cacheData.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return cacheData;

    const updatedProjects = cacheData.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            lifecycleStatus,
            isExcludedFromActiveKpis: isExcluded,
            lifecycleUpdatedAt: nowIso,
          }
        : p,
    );
    return {
      ...cacheData,
      projects: updatedProjects,
    };
  }

  if (Array.isArray(cacheData.data?.projects)) {
    const idx = cacheData.data.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return cacheData;

    const updatedProjects = cacheData.data.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            lifecycleStatus,
            isExcludedFromActiveKpis: isExcluded,
            lifecycleUpdatedAt: nowIso,
          }
        : p,
    );
    return {
      ...cacheData,
      data: {
        ...cacheData.data,
        projects: updatedProjects,
      },
    };
  }

  return cacheData;
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

  const idx = projectsList.findIndex((p) => p.id === projectId);
  if (idx === -1) return projectsList;

  const isExcluded = lifecycleStatus !== "DOING";
  return projectsList.map((p) =>
    p.id === projectId
      ? {
          ...p,
          lifecycleStatus,
          isExcludedFromActiveKpis: isExcluded,
        }
      : p,
  );
}
