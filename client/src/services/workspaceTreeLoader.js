export function resolveCachedProjectsList(queryClient, userId) {
  if (!queryClient) return [];

  const directKey = ["projects", userId];
  const directState = queryClient.getQueryState?.(directKey);
  const direct = queryClient.getQueryData(directKey);
  if (!directState?.isInvalidated && Array.isArray(direct) && direct.length > 0) {
    return direct;
  }

  const allProjectQueries = queryClient.getQueriesData({
    queryKey: ["projects"],
  });
  for (const [key, data] of allProjectQueries) {
    const state = queryClient.getQueryState?.(key);
    if (!state?.isInvalidated && Array.isArray(data) && data.length > 0) {
      return data;
    }
  }

  const portfolioKey = ["projectsPortfolio", "live"];
  const portfolioState = queryClient.getQueryState?.(portfolioKey);
  const portfolioRaw = portfolioState?.isInvalidated
    ? null
    : queryClient.getQueryData(portfolioKey);
  const portfolioProjects =
    portfolioRaw?.data?.projects || portfolioRaw?.projects || null;
  if (Array.isArray(portfolioProjects) && portfolioProjects.length > 0) {
    return portfolioProjects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || "",
      repoUrl: p.repoUrl || null,
      defaultBranch: p.defaultBranch || "main",
      lifecycleStatus: p.lifecycleStatus || "NOT_STARTED",
      lifecycleUpdatedAt: p.lifecycleUpdatedAt || p.updatedAt || null,
      isPinned: Boolean(p.isPinned),
      activeSnapshotId: p.snapshotId || p.activeSnapshotId || null,
      latestSnapshotId: p.snapshotId || p.latestSnapshotId || null,
      snapshots: p.snapshotId ? [{ id: p.snapshotId }] : [],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  return [];
}

export function readCachedProjectTree(queryClient, userId, projectId) {
  if (!queryClient || !projectId) return null;
  const queryKey = ["projectTree", userId, projectId];
  const data = queryClient.getQueryData(queryKey);
  if (!data) return null;

  const tree = Array.isArray(data) ? data : data.tree;
  if (!Array.isArray(tree)) return null;

  const state = queryClient.getQueryState(queryKey);
  return {
    tree,
    snapshotId: Array.isArray(data) ? null : (data.snapshotId ?? null),
    workspaceRevision: Array.isArray(data)
      ? null
      : (data.workspaceRevision ?? null),
    isInvalidated: Boolean(state?.isInvalidated),
  };
}

export function shouldFetchExplorerTreeOnSwitch({
  activeActivity,
  projectId,
  userId,
  queryClient,
  isLoadingTree,
  loadedTreeProjectId,
}) {
  if (activeActivity !== "explorer" || !projectId || isLoadingTree) {
    return false;
  }
  if (loadedTreeProjectId !== projectId) {
    return true;
  }
  if (!queryClient) return false;

  const queryState = queryClient.getQueryState([
    "projectTree",
    userId,
    projectId,
  ]);
  if (!queryState) return true;
  if (queryState.isInvalidated || queryState.status === "error") return true;

  const cachedTree = Array.isArray(queryState.data)
    ? queryState.data
    : queryState.data?.tree;
  return !Array.isArray(cachedTree);
}

const isCancellationError = (err) =>
  err?.name === "CancelledError" ||
  err?.name === "AbortError" ||
  /cancelled/i.test(err?.message || "");

export async function loadWorkspaceProjectAndTree({
  queryClient,
  userId,
  activeProjId = null,
  retries = 3,
  delay = 2000,
  forceRefresh = false,
  getProjectsApi,
  getProjectTreeApi,
  isStaleRequest = () => false,
  onLoadingChange = null,
  onSeedProjects = null,
  onSeedProject = null,
  onProjectsLoaded = null,
  onProjectSelected = null,
  onNoProjects = null,
  onTreeLoaded = null,
  onTreeNotReady = null,
  onLoadFailed = null,
}) {
  const projectsQueryState = queryClient?.getQueryState?.([
    "projects",
    userId,
  ]);
  const isProjectsCacheInvalidated = Boolean(projectsQueryState?.isInvalidated);

  const seededProjects = isProjectsCacheInvalidated
    ? []
    : resolveCachedProjectsList(queryClient, userId);
  const seededTarget =
    seededProjects.length > 0
      ? activeProjId
        ? seededProjects.find((p) => p.id === activeProjId) || null
        : seededProjects[0]
      : null;

  if (seededProjects.length > 0) {
    onSeedProjects?.(seededProjects);
    if (seededTarget) {
      onSeedProject?.(seededTarget);
    }
  }

  const cachedTree =
    !forceRefresh && seededTarget?.id
      ? readCachedProjectTree(queryClient, userId, seededTarget.id)
      : null;
  const hasHydratedCache = Boolean(cachedTree && !cachedTree.isInvalidated);

  if (hasHydratedCache) {
    onTreeLoaded?.({
      projectId: seededTarget.id,
      tree: cachedTree.tree,
      snapshotId: cachedTree.snapshotId,
      workspaceRevision: cachedTree.workspaceRevision,
    });
    onLoadingChange?.(false);
  } else {
    onLoadingChange?.(true);
  }

  let speculativeSuperseded = false;

  const fetchTreeWithRetries = async (
    targetProjectId,
    { isSpeculative = false } = {},
  ) => {
    const isAborted = () =>
      isStaleRequest() || (isSpeculative && speculativeSuperseded);
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (isAborted()) return null;
      try {
        const tree = await queryClient.fetchQuery({
          queryKey: ["projectTree", userId, targetProjectId],
          queryFn: async () => {
            const res = await getProjectTreeApi(targetProjectId);
            if (res?.success === false) {
              const err = new Error(
                res.message || "Project snapshot not ready",
              );
              err.status = 202;
              throw err;
            }
            return {
              tree: res?.data || [],
              snapshotId: res?.snapshotId ?? null,
              workspaceRevision: res?.workspaceRevision ?? null,
            };
          },
          staleTime: forceRefresh ? 0 : 15 * 1000,
          retry: false,
        });
        if (isAborted()) return null;

        const sourceTree = Array.isArray(tree) ? tree : tree?.tree || [];
        onTreeLoaded?.({
          projectId: targetProjectId,
          tree: sourceTree,
          snapshotId: Array.isArray(tree) ? null : (tree?.snapshotId ?? null),
          workspaceRevision: Array.isArray(tree)
            ? null
            : (tree?.workspaceRevision ?? null),
        });
        if (
          !hasHydratedCache &&
          (!isSpeculative || (activeProjId && targetProjectId === activeProjId))
        ) {
          onLoadingChange?.(false);
        }
        return sourceTree;
      } catch (treeErr) {
        if (isCancellationError(treeErr) || isAborted()) {
          return null;
        }
        lastError = treeErr;
        if (attempt < retries && delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (lastError && !isAborted()) {
      onTreeNotReady?.(lastError, targetProjectId);
    }
    return null;
  };

  try {
    const canSpeculateTree =
      Boolean(seededTarget?.id) &&
      (!activeProjId || seededTarget.id === activeProjId);
    const speculativeTreePromise = canSpeculateTree
      ? fetchTreeWithRetries(seededTarget.id, { isSpeculative: true })
      : null;

    const loadedProjects = await queryClient.fetchQuery({
      queryKey: ["projects", userId],
      queryFn: async () => {
        const res = await getProjectsApi();
        return res?.projects || [];
      },
      staleTime: 5 * 60 * 1000,
      retry: false,
    });

    if (isStaleRequest()) {
      speculativeSuperseded = true;
      return;
    }

    if (Array.isArray(loadedProjects) && loadedProjects.length > 0) {
      onProjectsLoaded?.(loadedProjects);
      const targetProj = activeProjId
        ? loadedProjects.find((p) => p.id === activeProjId) || loadedProjects[0]
        : loadedProjects[0];
      onProjectSelected?.(targetProj);

      if (speculativeTreePromise && targetProj.id === seededTarget?.id) {
        await speculativeTreePromise;
      } else {
        speculativeSuperseded = true;
        onLoadingChange?.(true);
        await fetchTreeWithRetries(targetProj.id);
      }
    } else {
      speculativeSuperseded = true;
      onNoProjects?.();
    }
  } catch (err) {
    speculativeSuperseded = true;
    if (isCancellationError(err) || isStaleRequest()) {
      return;
    }
    onLoadFailed?.(err);
  } finally {
    if (!isStaleRequest()) {
      onLoadingChange?.(false);
    }
  }
}
