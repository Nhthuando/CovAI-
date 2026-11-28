/**
 * Workspace Navigation Utility
 * Builds deep-linking URLs from Unified Dashboard to child test workspaces
 * with contextual focus parameters without altering original workspace state.
 */

/**
 * @param {Location | { pathname: string, search: string }} location
 * @param {'unit' | 'integration' | 'system'} pillar
 * @param {{ focusFile?: string, focusEndpoint?: string, focusScenario?: string }} [focus]
 * @returns {string} URL query string
 */
export function buildWorkspaceUrl(location, pillar, focus = {}) {
  const currentSearch = location?.search || "";
  const params = new URLSearchParams(currentSearch);

  // Navigate to coverage workspace for specific pillar
  params.set("tab", "coverage");
  params.set("coverageType", pillar);

  // Clean previous focus params to avoid cross-contamination
  params.delete("focusFile");
  params.delete("focusEndpoint");
  params.delete("focusScenario");

  if (focus.focusFile) {
    params.set("focusFile", focus.focusFile);
  }
  if (focus.focusEndpoint) {
    params.set("focusEndpoint", focus.focusEndpoint);
  }
  if (focus.focusScenario) {
    params.set("focusScenario", focus.focusScenario);
  }

  const pathname = location?.pathname || "/main-editor";
  return `${pathname}?${params.toString()}`;
}

/**
 * Build deep-link URL to the Chatbot AI Trustworthiness Evaluation workspace tab.
 * @param {Location | { pathname: string, search: string }} location
 * @param {string} [projectId]
 * @returns {string}
 */
export function buildTrustworthinessUrl(location, projectId = "") {
  const currentSearch = location?.search || "";
  const params = new URLSearchParams(currentSearch);
  if (projectId) {
    params.set("projectId", projectId);
  }
  params.set("tab", "trustworthiness");
  params.delete("coverageType");
  params.delete("focusFile");
  params.delete("focusEndpoint");
  params.delete("focusScenario");
  const pathname = location?.pathname || "/main-editor";
  return `${pathname}?${params.toString()}`;
}

export default buildWorkspaceUrl;
