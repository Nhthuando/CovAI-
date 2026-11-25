import { collaborationRequest } from "./collaborationHttp";
import { getAIModelHeaders } from "./aiModel.service";

const scenarioPath = (snapshotId, aiTestId, scenarioId) => `/coverage/${encodeURIComponent(snapshotId)}/integration/ai-test/${encodeURIComponent(aiTestId)}/scenario${scenarioId !== undefined ? `/${encodeURIComponent(scenarioId)}` : ""}`;

export const getIntegrationScenarioApi = (snapshotId, aiTestId, scenarioId, hint = {}) => {
  const params = new URLSearchParams();
  if (hint?.filePath) params.set("filePath", hint.filePath);
  if (hint?.testName) params.set("testName", hint.testName);
  if (hint?.origin) params.set("origin", hint.origin);
  const qs = params.toString();
  return collaborationRequest(`${scenarioPath(snapshotId, aiTestId, scenarioId)}${qs ? `?${qs}` : ""}`);
};

export function mutateIntegrationScenarioApi({ snapshotId, aiTestId, scenarioId, action, expectedVersion, code, endpoint, enable, filePath, testName, origin }) {
  const method = { ADD: "POST", UPDATE: "PUT", DELETE: "DELETE", TOGGLE: "PATCH", REGENERATE: "POST" }[action];
  if (!method) throw new Error("Unsupported integration scenario action");
  const suffix = action === "TOGGLE" ? "/toggle" : action === "REGENERATE" ? "/regenerate" : "";
  return collaborationRequest(`${scenarioPath(snapshotId, aiTestId, action === "ADD" ? undefined : scenarioId)}${suffix}`, {
    method, headers: getAIModelHeaders(), body: { expectedVersion, code, endpoint, enable, filePath, testName, origin },
  });
}

export function bulkDeleteIntegrationScenariosApi(snapshotId, scenarios = []) {
  return collaborationRequest(
    `/coverage/${encodeURIComponent(snapshotId)}/integration/scenarios/bulk-delete`,
    {
      method: "POST",
      headers: getAIModelHeaders(),
      body: { scenarios },
    },
  );
}
