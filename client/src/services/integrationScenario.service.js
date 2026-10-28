import { collaborationRequest } from "./collaborationHttp";
import { getAIModelHeaders } from "./aiModel.service";

const scenarioPath = (snapshotId, aiTestId, scenarioId) => `/coverage/${encodeURIComponent(snapshotId)}/integration/ai-test/${encodeURIComponent(aiTestId)}/scenario${scenarioId !== undefined ? `/${encodeURIComponent(scenarioId)}` : ""}`;

export const getIntegrationScenarioApi = (snapshotId, aiTestId, scenarioId) => collaborationRequest(scenarioPath(snapshotId, aiTestId, scenarioId));

export function mutateIntegrationScenarioApi({ snapshotId, aiTestId, scenarioId, action, expectedVersion, code, endpoint, enable }) {
  const method = { ADD: "POST", UPDATE: "PUT", DELETE: "DELETE", TOGGLE: "PATCH", REGENERATE: "POST" }[action];
  if (!method) throw new Error("Unsupported integration scenario action");
  const suffix = action === "TOGGLE" ? "/toggle" : action === "REGENERATE" ? "/regenerate" : "";
  return collaborationRequest(`${scenarioPath(snapshotId, aiTestId, action === "ADD" ? undefined : scenarioId)}${suffix}`, {
    method, headers: getAIModelHeaders(), body: { expectedVersion, code, endpoint, enable },
  });
}
