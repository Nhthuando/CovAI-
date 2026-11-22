const EMPTY_OPS = Object.freeze({ deletes: [], updates: [], adds: [] });

function storageKey(scope, snapshotId) {
  return snapshotId ? `covai:stagedOps:${scope}:${snapshotId}` : null;
}

export function normPath(p = "") {
  return String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").trim().toLowerCase();
}

export function normTitle(t = "") {
  return String(t || "").trim().toLowerCase();
}

export function extractBlockTitle(code = "", fallback = "") {
  const m = String(code || "").match(/\b(?:it|test)(?:\.(?:only|skip))?\s*\(\s*(['"`])([\s\S]*?)\1/);
  return (m?.[2] || fallback || "").trim();
}

export function loadStagedOps(scope, snapshotId) {
  const key = storageKey(scope, snapshotId);
  if (!key) return { deletes: [], updates: [], adds: [] };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { deletes: [], updates: [], adds: [] };
    const parsed = JSON.parse(raw);
    return {
      deletes: Array.isArray(parsed?.deletes) ? parsed.deletes : [],
      updates: Array.isArray(parsed?.updates) ? parsed.updates : [],
      adds: Array.isArray(parsed?.adds) ? parsed.adds : [],
    };
  } catch {
    return { deletes: [], updates: [], adds: [] };
  }
}

export function saveStagedOps(scope, snapshotId, ops) {
  const key = storageKey(scope, snapshotId);
  if (!key) return;
  try {
    const next = ops || EMPTY_OPS;
    if (!next.deletes?.length && !next.updates?.length && !next.adds?.length) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(next));
    }
  } catch {
    // Ignore quota errors in browser storage
  }
}

export function countStagedOps(ops) {
  if (!ops) return 0;
  return (ops.adds?.length || 0) + (ops.updates?.length || 0) + (ops.deletes?.length || 0);
}

export function matchesStagedTarget(entry, target) {
  if (!entry || !target) return false;
  if (entry.key && target.key && entry.key === target.key) return true;
  if (entry.id && target.id && entry.id === target.id) return true;
  if (entry.aiTestId && target.aiTestId && entry.aiTestId === target.aiTestId && entry.scenarioId && target.scenarioId === entry.scenarioId) {
    return true;
  }
  const eTitle = normTitle(entry.originalTestName || entry.testName || entry.title);
  const tTitle = normTitle(target.originalTestName || target.testName || target.title);
  if (!eTitle || eTitle !== tTitle) return false;

  const eFile = normPath(entry.testFile || entry.filePath);
  const tFile = normPath(target.testFile || target.filePath);
  if (!eFile || !tFile) return true;
  return eFile === tFile || eFile.endsWith(tFile) || tFile.endsWith(eFile);
}

export function stageAddOp(ops, item) {
  const base = ops || EMPTY_OPS;
  const id = item.id || `staged::${Date.now()}::${Math.random().toString(36).slice(2, 7)}`;
  const entry = { ...item, id, key: item.key || id, origin: "STAGED_ADD" };
  return {
    ...base,
    adds: [...(base.adds || []), entry],
  };
}

export function stageUpdateOp(ops, item) {
  const base = ops || EMPTY_OPS;
  const target = {
    key: item.key,
    id: item.id,
    aiTestId: item.aiTestId,
    scenarioId: item.scenarioId,
    testFile: item.testFile || item.filePath,
    testName: item.originalTestName || item.testName || item.title,
  };
  const inAddsIdx = (base.adds || []).findIndex((a) => matchesStagedTarget(a, target));
  if (inAddsIdx >= 0) {
    const nextAdds = [...base.adds];
    nextAdds[inAddsIdx] = {
      ...nextAdds[inAddsIdx],
      ...item,
      id: nextAdds[inAddsIdx].id,
      key: nextAdds[inAddsIdx].key,
      origin: "STAGED_ADD",
    };
    return { ...base, adds: nextAdds };
  }
  const nextUpdates = (base.updates || []).filter((u) => !matchesStagedTarget(u, target));
  nextUpdates.push({ ...item, origin: item.origin || "STAGED_EDIT" });
  return { ...base, updates: nextUpdates };
}

export function stageDeleteOp(ops, item) {
  const base = ops || EMPTY_OPS;
  const target = {
    key: item.key,
    id: item.id,
    aiTestId: item.aiTestId,
    scenarioId: item.scenarioId,
    testFile: item.testFile || item.filePath,
    testName: item.originalTestName || item.testName || item.title,
  };
  // Canceling out a newly added temp scenario requires zero backend delete
  if ((base.adds || []).some((a) => matchesStagedTarget(a, target))) {
    return {
      ...base,
      adds: (base.adds || []).filter((a) => !matchesStagedTarget(a, target)),
    };
  }
  const nextUpdates = (base.updates || []).filter((u) => !matchesStagedTarget(u, target));
  const alreadyDeleted = (base.deletes || []).some((d) => matchesStagedTarget(d, target));
  const nextDeletes = alreadyDeleted ? base.deletes : [...(base.deletes || []), item];
  return { ...base, updates: nextUpdates, deletes: nextDeletes };
}
