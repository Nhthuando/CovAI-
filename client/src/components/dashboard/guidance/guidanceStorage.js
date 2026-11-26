const TOUR_STORAGE_PREFIX = "covai_tour_seen_v1_";

function storageKey(userId) {
  return `${TOUR_STORAGE_PREFIX}${userId || "anon"}`;
}

export function loadSeenTours(userId, storage = typeof window !== "undefined" ? window.localStorage : null) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function hasSeenTour(userId, tourKey, storage) {
  if (!tourKey) return true;
  const seen = loadSeenTours(userId, storage);
  return Boolean(seen[tourKey]);
}

export function markTourSeen(userId, tourKey, storage = typeof window !== "undefined" ? window.localStorage : null) {
  if (!storage || !tourKey) return;
  try {
    const next = { ...loadSeenTours(userId, storage), [tourKey]: true };
    storage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function resetGuidanceTours(storage = typeof window !== "undefined" ? window.localStorage : null) {
  if (!storage) return;
  try {
    const keysToDelete = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(TOUR_STORAGE_PREFIX)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => storage.removeItem(key));
  } catch {
    // Ignore storage access errors
  }
}
