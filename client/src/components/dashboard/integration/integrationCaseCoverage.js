export {
  CATEGORY_LABELS,
  CASE_DEFINITIONS,
  isScenarioPassed,
  isScenarioFailed,
  classifyScenario,
  getScenarioCaseKey,
  getEndpointRequiredCases,
  annotateEndpointScenarios,
  getEndpointCaseCoverage,
  summarizeIntegrationFailure,
} from "../../../../../shared/integrationCaseCoverage.js";

export const getEpIdentityKey = (ep) =>
  `${(ep?.method || "GET").toUpperCase()}:${ep?.path || ep?.fullPath || "/"}`;

export const getScenarioIdentityKey = (sc, epKey = "") =>
  `${epKey}::${String(sc?.title || sc?.testName || sc?.scenarioId || sc?.id || "").trim()}`;
