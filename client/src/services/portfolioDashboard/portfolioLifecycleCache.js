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

/**
 * Immutably remove a deleted project from the portfolio React Query cache.
 */
export function removeProjectFromPortfolioCache(cacheData, projectId) {
  if (!cacheData || !projectId) return cacheData;

  if (Array.isArray(cacheData.projects)) {
    const projects = cacheData.projects.filter((p) => p.id !== projectId);
    if (projects.length === cacheData.projects.length) return cacheData;
    return { ...cacheData, projects };
  }

  if (Array.isArray(cacheData.data?.projects)) {
    const projects = cacheData.data.projects.filter((p) => p.id !== projectId);
    if (projects.length === cacheData.data.projects.length) return cacheData;
    return { ...cacheData, data: { ...cacheData.data, projects } };
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
