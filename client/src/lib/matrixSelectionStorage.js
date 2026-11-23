/**
 * Persist and manage parent/child checkbox selections per workspace scope and snapshotId
 * so ticked items survive test runs, subtab switches, generated drafts, and page reloads.
 */

function buildSelectionStorageKey(scope, snapshotId) {
  return snapshotId ? `covai:matrixSelection:${scope}:${snapshotId}` : null;
}

export function loadMatrixSelection(scope, snapshotId) {
  const key = buildSelectionStorageKey(scope, snapshotId);
  if (!key || typeof window === "undefined") {
    return { parents: new Set(), children: new Set() };
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { parents: new Set(), children: new Set() };
    const parsed = JSON.parse(raw);
    return {
      parents: new Set(Array.isArray(parsed?.parents) ? parsed.parents : []),
      children: new Set(Array.isArray(parsed?.children) ? parsed.children : []),
    };
  } catch (err) {
    console.warn(`[matrixSelectionStorage] Failed to load ${scope} selection:`, err);
    return { parents: new Set(), children: new Set() };
  }
}

export function saveMatrixSelection(scope, snapshotId, parents, children) {
  const key = buildSelectionStorageKey(scope, snapshotId);
  if (!key || typeof window === "undefined") return;
  try {
    const parentArr = Array.from(parents || []);
    const childArr = Array.from(children || []);
    if (parentArr.length === 0 && childArr.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(
        key,
        JSON.stringify({ parents: parentArr, children: childArr }),
      );
    }
  } catch (err) {
    console.warn(`[matrixSelectionStorage] Failed to save ${scope} selection:`, err);
  }
}

export function toggleParentSelection({
  parentKey,
  childKeys = [],
  legacyChildKeys = [],
  parents,
  children,
}) {
  const isCurrentlySelected = parents.has(parentKey);
  const nextParents = new Set(parents);
  const nextChildren = new Set(children);

  if (isCurrentlySelected) {
    nextParents.delete(parentKey);
    for (const ck of childKeys) nextChildren.delete(ck);
    for (const lck of legacyChildKeys) nextChildren.delete(lck);
  } else {
    nextParents.add(parentKey);
    for (const ck of childKeys) nextChildren.add(ck);
  }

  return { parents: nextParents, children: nextChildren };
}

export function toggleAllParentsSelection({
  items = [],
  allSelected,
  parents,
  children,
}) {
  const nextParents = new Set(parents);
  const nextChildren = new Set(children);

  for (const { parentKey, childKeys = [], legacyChildKeys = [] } of items) {
    if (!parentKey) continue;
    if (allSelected) {
      nextParents.delete(parentKey);
      for (const ck of childKeys) nextChildren.delete(ck);
      for (const lck of legacyChildKeys) nextChildren.delete(lck);
    } else {
      nextParents.add(parentKey);
      for (const ck of childKeys) nextChildren.add(ck);
    }
  }

  return { parents: nextParents, children: nextChildren };
}

export function toggleChildSelection({
  childKey,
  legacyChildKey = null,
  parentKey = null,
  siblingKeys = [],
  parents,
  children,
}) {
  const parentSelected = Boolean(parentKey && parents.has(parentKey));
  const wasSelected =
    parentSelected ||
    children.has(childKey) ||
    Boolean(legacyChildKey && children.has(legacyChildKey));

  const nextParents = new Set(parents);
  const nextChildren = new Set(children);

  if (wasSelected) {
    if (parentSelected) {
      // Materialize implicit parent coverage onto sibling children before unchecking one child.
      nextParents.delete(parentKey);
      for (const sk of siblingKeys) {
        if (sk && sk !== childKey) nextChildren.add(sk);
      }
    } else if (parentKey) {
      nextParents.delete(parentKey);
    }
    nextChildren.delete(childKey);
    if (legacyChildKey) nextChildren.delete(legacyChildKey);
  } else {
    nextChildren.add(childKey);
    if (
      parentKey &&
      siblingKeys.length > 0 &&
      siblingKeys.every((sk) => nextChildren.has(sk))
    ) {
      nextParents.add(parentKey);
    }
  }

  return { parents: nextParents, children: nextChildren };
}
