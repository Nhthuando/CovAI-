import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import {
  resolveCachedProjectsList,
  readCachedProjectTree,
  loadWorkspaceProjectAndTree,
  shouldFetchExplorerTreeOnSwitch,
} from "./workspaceTreeLoader.js";

function createTestQueryClient(t) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });
  t?.after?.(() => qc.clear());
  return qc;
}

test("(1) initial mount when projectsPortfolio cache already exists loads file tree and exits loading state", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";
  const projectId = "proj-1";

  queryClient.setQueryData(["projectsPortfolio", "live"], {
    data: {
      projects: [
        {
          id: projectId,
          name: "Demo Repo",
          snapshotId: "snap-1",
          defaultBranch: "main",
        },
      ],
    },
  });

  const seeded = resolveCachedProjectsList(queryClient, userId);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].id, projectId);

  let treeCalls = 0;
  let projectsCalls = 0;
  const loadingStates = [];
  let renderedTree = [];
  let loadedVersion = null;

  await loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: projectId,
    retries: 1,
    delay: 0,
    getProjectsApi: async () => {
      projectsCalls += 1;
      return {
        projects: [{ id: projectId, name: "Demo Repo", activeSnapshotId: "snap-1" }],
      };
    },
    getProjectTreeApi: async (id) => {
      treeCalls += 1;
      assert.equal(id, projectId);
      return {
        success: true,
        data: [{ id: "src/index.js", name: "index.js", type: "file", lang: "js" }],
        snapshotId: "snap-1",
        workspaceRevision: 3,
      };
    },
    onLoadingChange: (loading) => loadingStates.push(loading),
    onTreeLoaded: ({ tree, snapshotId, workspaceRevision }) => {
      renderedTree = tree;
      loadedVersion = { snapshotId, workspaceRevision };
    },
  });

  assert.equal(projectsCalls, 1);
  assert.equal(treeCalls, 1);
  assert.equal(renderedTree.length, 1);
  assert.equal(renderedTree[0].id, "src/index.js");
  assert.deepEqual(loadedVersion, { snapshotId: "snap-1", workspaceRevision: 3 });
  assert.equal(loadingStates[0], true);
  assert.equal(loadingStates.at(-1), false);
});

test("(1b) initial mount when projects and projectTree caches exist hydrates immediately without skeleton", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";
  const projectId = "proj-cached";

  queryClient.setQueryData(["projects", userId], [
    { id: projectId, name: "Cached Repo", activeSnapshotId: "snap-9" },
  ]);
  queryClient.setQueryData(["projectTree", userId, projectId], {
    tree: [{ id: "README.md", name: "README.md", type: "file", lang: "md" }],
    snapshotId: "snap-9",
    workspaceRevision: 7,
  });

  const cached = readCachedProjectTree(queryClient, userId, projectId);
  assert.ok(cached);
  assert.equal(cached.tree.length, 1);
  assert.equal(cached.isInvalidated, false);

  const loadingStates = [];
  let treeCalls = 0;
  let renderedTree = [];

  await loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: projectId,
    retries: 1,
    delay: 0,
    getProjectsApi: async () => {
      throw new Error("should use cached projects within 5m staleTime");
    },
    getProjectTreeApi: async () => {
      treeCalls += 1;
      return { success: true, data: [] };
    },
    onLoadingChange: (loading) => loadingStates.push(loading),
    onTreeLoaded: ({ tree }) => {
      renderedTree = tree;
    },
  });

  assert.equal(treeCalls, 0);
  assert.equal(renderedTree[0].id, "README.md");
  assert.deepEqual(loadingStates, [false, false]);
});

test("(2) switching from other tabs/features (overview, coverage, settings) to Explorer fetches when missing/invalidated and renders promptly", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";
  const projectId = "proj-2";

  // While on overview or coverage, shouldFetchExplorerTreeOnSwitch is false
  assert.equal(
    shouldFetchExplorerTreeOnSwitch({
      activeActivity: "overview",
      projectId,
      userId,
      queryClient,
      isLoadingTree: false,
      loadedTreeProjectId: null,
    }),
    false,
  );
  assert.equal(
    shouldFetchExplorerTreeOnSwitch({
      activeActivity: "coverage",
      projectId,
      userId,
      queryClient,
      isLoadingTree: false,
      loadedTreeProjectId: null,
    }),
    false,
  );

  // Switching to explorer when tree hasn't loaded yet triggers fetch
  assert.equal(
    shouldFetchExplorerTreeOnSwitch({
      activeActivity: "explorer",
      projectId,
      userId,
      queryClient,
      isLoadingTree: false,
      loadedTreeProjectId: null,
    }),
    true,
  );

  // While already loading, do not trigger a duplicate fetch
  assert.equal(
    shouldFetchExplorerTreeOnSwitch({
      activeActivity: "explorer",
      projectId,
      userId,
      queryClient,
      isLoadingTree: true,
      loadedTreeProjectId: null,
    }),
    false,
  );

  let renderedTree = [];
  let loadedTreeProjectId = null;
  let isLoadingTree = false;

  queryClient.setQueryData(["projects", userId], [{ id: projectId, name: "Switch Repo" }]);

  await loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: projectId,
    retries: 1,
    delay: 0,
    getProjectsApi: async () => ({ projects: [{ id: projectId, name: "Switch Repo" }] }),
    getProjectTreeApi: async () => ({
      success: true,
      data: [{ id: "app.js", name: "app.js", type: "file", lang: "js" }],
      snapshotId: "snap-2",
      workspaceRevision: 1,
    }),
    onLoadingChange: (loading) => {
      isLoadingTree = loading;
    },
    onTreeLoaded: ({ projectId: loadedId, tree }) => {
      loadedTreeProjectId = loadedId;
      renderedTree = tree;
    },
  });

  assert.equal(isLoadingTree, false);
  assert.equal(renderedTree.length, 1);
  assert.equal(
    shouldFetchExplorerTreeOnSwitch({
      activeActivity: "explorer",
      projectId,
      userId,
      queryClient,
      isLoadingTree,
      loadedTreeProjectId,
    }),
    false,
  );

  // If invalidated while on another tab, switching back to explorer triggers reload
  await queryClient.invalidateQueries({ queryKey: ["projectTree", userId, projectId] });
  assert.equal(
    shouldFetchExplorerTreeOnSwitch({
      activeActivity: "explorer",
      projectId,
      userId,
      queryClient,
      isLoadingTree: false,
      loadedTreeProjectId,
    }),
    true,
  );
});

test("(3) clicking Refresh Files bypasses staleTime cache, reloads tree, and exits loading state", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";
  const projectId = "proj-refresh";

  queryClient.setQueryData(["projects", userId], [{ id: projectId, name: "Refresh Repo" }]);

  let treeCallCount = 0;
  let currentTree = [];
  let isLoadingTree = true;

  const runLoad = (forceRefresh = false) =>
    loadWorkspaceProjectAndTree({
      queryClient,
      userId,
      activeProjId: projectId,
      retries: 1,
      delay: 0,
      forceRefresh,
      getProjectsApi: async () => ({ projects: [{ id: projectId, name: "Refresh Repo" }] }),
      getProjectTreeApi: async () => {
        treeCallCount += 1;
        return {
          success: true,
          data:
            treeCallCount === 1
              ? [{ id: "old.js", name: "old.js", type: "file", lang: "js" }]
              : [
                  { id: "old.js", name: "old.js", type: "file", lang: "js" },
                  { id: "new.js", name: "new.js", type: "file", lang: "js" },
                ],
          snapshotId: "snap-r",
          workspaceRevision: treeCallCount,
        };
      },
      onLoadingChange: (loading) => {
        isLoadingTree = loading;
      },
      onTreeLoaded: ({ tree }) => {
        currentTree = tree;
      },
    });

  await runLoad(false);
  assert.equal(treeCallCount, 1);
  assert.equal(currentTree.length, 1);
  assert.equal(isLoadingTree, false);

  // Immediate Refresh Files within 15s staleTime MUST force a fresh API request
  await runLoad(true);
  assert.equal(treeCallCount, 2);
  assert.equal(currentTree.length, 2);
  assert.equal(currentTree[1].id, "new.js");
  assert.equal(isLoadingTree, false);
});

test("stale in-flight project load does not overwrite newer project state or exit loading prematurely", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";
  queryClient.setQueryData(["projects", userId], [
    { id: "proj-a", name: "Project A" },
    { id: "proj-b", name: "Project B" },
  ]);

  let activeRequest = 1;
  let resolveSlowTree;
  let finalTree = [];
  let isLoadingTree = true;

  const slowPromise = loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: "proj-a",
    retries: 1,
    delay: 0,
    isStaleRequest: () => activeRequest !== 1,
    getProjectsApi: async () => ({ projects: [] }),
    getProjectTreeApi: () =>
      new Promise((resolve) => {
        resolveSlowTree = resolve;
      }),
    onLoadingChange: (loading) => {
      isLoadingTree = loading;
    },
    onTreeLoaded: ({ tree }) => {
      finalTree = tree;
    },
  });

  // User switches to proj-b while proj-a tree is still pending
  activeRequest = 2;
  await loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: "proj-b",
    retries: 1,
    delay: 0,
    isStaleRequest: () => activeRequest !== 2,
    getProjectsApi: async () => ({ projects: [] }),
    getProjectTreeApi: async () => ({
      success: true,
      data: [{ id: "b.js", name: "b.js", type: "file", lang: "js" }],
      snapshotId: "snap-b",
      workspaceRevision: 1,
    }),
    onLoadingChange: (loading) => {
      isLoadingTree = loading;
    },
    onTreeLoaded: ({ tree }) => {
      finalTree = tree;
    },
  });

  // Resolve slow proj-a after proj-b finished
  resolveSlowTree({
    success: true,
    data: [{ id: "a.js", name: "a.js", type: "file", lang: "js" }],
    snapshotId: "snap-a",
    workspaceRevision: 1,
  });
  await slowPromise;

  assert.equal(isLoadingTree, false);
  assert.equal(finalTree.length, 1);
  assert.equal(finalTree[0].id, "b.js");
});

test("202 snapshot-not-ready response retries and exits loading state without caching empty tree", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";
  const projectId = "proj-202";
  queryClient.setQueryData(["projects", userId], [{ id: projectId, name: "Pending Repo" }]);

  let attempts = 0;
  let warned = false;
  let isLoadingTree = true;

  await loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: projectId,
    retries: 2,
    delay: 0,
    getProjectsApi: async () => ({ projects: [{ id: projectId, name: "Pending Repo" }] }),
    getProjectTreeApi: async () => {
      attempts += 1;
      return { success: false, message: "Project snapshot not ready" };
    },
    onLoadingChange: (loading) => {
      isLoadingTree = loading;
    },
    onTreeNotReady: () => {
      warned = true;
    },
  });

  assert.equal(attempts, 2);
  assert.equal(warned, true);
  assert.equal(isLoadingTree, false);
  assert.equal(readCachedProjectTree(queryClient, userId, projectId), null);
});

test("speculative tree exits loading skeleton as soon as /tree resolves before slower /projects response", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";
  const projectId = "proj-fast-tree";

  queryClient.setQueryData(["projectsPortfolio", "live"], {
    data: { projects: [{ id: projectId, name: "Fast Tree Repo", snapshotId: "snap-1" }] },
  });

  let resolveProjects;
  const events = [];

  const loadPromise = loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: projectId,
    retries: 1,
    delay: 0,
    getProjectsApi: () =>
      new Promise((resolve) => {
        resolveProjects = resolve;
      }),
    getProjectTreeApi: async () => ({
      success: true,
      data: [{ id: "src/app.js", name: "app.js", type: "file", lang: "js" }],
      snapshotId: "snap-1",
      workspaceRevision: 1,
    }),
    onLoadingChange: (loading) => events.push(`loading:${loading}`),
    onTreeLoaded: ({ tree }) => events.push(`tree:${tree[0]?.id}`),
  });

  // Allow speculative tree fetch microtasks to settle while getProjectsApi is still pending
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(events.includes("tree:src/app.js"));
  assert.equal(events.at(-1), "loading:false");

  resolveProjects({ projects: [{ id: projectId, name: "Fast Tree Repo" }] });
  await loadPromise;
  assert.equal(events.at(-1), "loading:false");
});

test("superseded speculative tree cannot overwrite newer targetProj tree when seededTarget mismatches", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";

  // Seed portfolio with proj-a while activeProjId is null; getProjectsApi returns proj-b first
  queryClient.setQueryData(["projectsPortfolio", "live"], {
    data: { projects: [{ id: "proj-a", name: "Old Project" }] },
  });

  let resolveSpeculativeA;
  let finalLoadedProjectId = null;
  let finalTree = [];
  let treeNotReadyCalls = 0;

  const loadPromise = loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: null,
    retries: 1,
    delay: 0,
    getProjectsApi: async () => ({
      projects: [{ id: "proj-b", name: "Active Project" }],
    }),
    getProjectTreeApi: (id) => {
      if (id === "proj-a") {
        return new Promise((resolve) => {
          resolveSpeculativeA = resolve;
        });
      }
      return Promise.resolve({
        success: true,
        data: [{ id: "b-only.js", name: "b-only.js", type: "file", lang: "js" }],
        snapshotId: "snap-b",
        workspaceRevision: 2,
      });
    },
    onTreeLoaded: ({ projectId, tree }) => {
      finalLoadedProjectId = projectId;
      finalTree = tree;
    },
    onTreeNotReady: () => {
      treeNotReadyCalls += 1;
    },
  });

  await loadPromise;
  assert.equal(finalLoadedProjectId, "proj-b");
  assert.equal(finalTree[0]?.id, "b-only.js");

  // Resolve slow superseded proj-a tree AFTER proj-b loaded
  resolveSpeculativeA({
    success: true,
    data: [{ id: "stale-a.js", name: "stale-a.js", type: "file", lang: "js" }],
    snapshotId: "snap-a",
    workspaceRevision: 1,
  });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(finalLoadedProjectId, "proj-b");
  assert.equal(finalTree[0]?.id, "b-only.js");
  assert.equal(treeNotReadyCalls, 0);
});

test("invalidated projects cache does not re-seed deleted project or speculatively fetch its tree", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";

  queryClient.setQueryData(["projects", userId], [{ id: "proj-deleted", name: "Deleted" }]);
  await queryClient.invalidateQueries({ queryKey: ["projects", userId] });

  const requestedTreeIds = [];
  let selectedId = null;

  await loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: null,
    retries: 1,
    delay: 0,
    getProjectsApi: async () => ({
      projects: [{ id: "proj-surviving", name: "Surviving" }],
    }),
    getProjectTreeApi: async (id) => {
      requestedTreeIds.push(id);
      return {
        success: true,
        data: [{ id: "main.js", name: "main.js", type: "file", lang: "js" }],
        snapshotId: "snap-s",
        workspaceRevision: 1,
      };
    },
    onProjectSelected: (proj) => {
      selectedId = proj?.id || null;
    },
  });

  assert.equal(selectedId, "proj-surviving");
  assert.deepEqual(requestedTreeIds, ["proj-surviving"]);
});

test("explicit activeProjId missing from projectsPortfolio cache does not seed or flash wrong project tree", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";

  queryClient.setQueryData(["projectsPortfolio", "live"], {
    data: { projects: [{ id: "proj-a", name: "Wrong Cached Alpha", snapshotId: "snap-a" }] },
  });
  queryClient.setQueryData(["projectTree", userId, "proj-a"], {
    tree: [{ id: "alpha-only.js", name: "alpha-only.js", type: "file", lang: "js" }],
    snapshotId: "snap-a",
    workspaceRevision: 1,
  });

  const seededProjectIds = [];
  const loadedTreeProjects = [];

  await loadWorkspaceProjectAndTree({
    queryClient,
    userId,
    activeProjId: "proj-b",
    retries: 1,
    delay: 0,
    getProjectsApi: async () => ({
      projects: [
        { id: "proj-a", name: "Wrong Cached Alpha", activeSnapshotId: "snap-a" },
        { id: "proj-b", name: "Target Beta", activeSnapshotId: "snap-b" },
      ],
    }),
    getProjectTreeApi: async (id) => ({
      success: true,
      data: [{ id: `${id}.js`, name: `${id}.js`, type: "file", lang: "js" }],
      snapshotId: `snap-${id}`,
      workspaceRevision: 1,
    }),
    onSeedProject: (proj) => seededProjectIds.push(proj?.id),
    onTreeLoaded: ({ projectId }) => loadedTreeProjects.push(projectId),
  });

  assert.deepEqual(seededProjectIds, []);
  assert.deepEqual(loadedTreeProjects, ["proj-b"]);
});

test("invalidated projectsPortfolio cache is ignored by resolveCachedProjectsList", async (t) => {
  const queryClient = createTestQueryClient(t);
  const userId = "user-1";

  queryClient.setQueryData(["projectsPortfolio", "live"], {
    data: { projects: [{ id: "proj-deleted", name: "Deleted" }] },
  });
  await queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });

  assert.deepEqual(resolveCachedProjectsList(queryClient, userId), []);
});
