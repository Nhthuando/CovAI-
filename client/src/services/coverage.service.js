import { editorAwareFetch } from './editorAwareRequest';
import { getAIModelHeaders } from './aiModel.service.js';
import { DEPENDENCY_INSTALL_REQUEST_TIMEOUT_MS } from '../../../shared/unitTestRuntime.js';
const BASE_URL = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "http://localhost:5000/api";

function getAuthHeaders() {
    const user = localStorage.getItem("user");
    const userToken = user ? JSON.parse(user).token : null;
    const token = localStorage.getItem("token") || userToken;

    return {
        "Content-Type": "application/json",
    ...getAIModelHeaders(),
        ...(token && {
            Authorization: `Bearer ${token}`,
        }),
    };
}

async function handleResponse(res) {
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        if (res.status === 401) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            localStorage.removeItem("userName");
            localStorage.removeItem("userEmail");

            window.location.href = "/login";
        }

        const msg = data.message || `API error (${res.status})`;
        const error = new Error(msg);
        error.status = res.status;
        error.data = data;
        throw error;
    }

    return data;
}

export async function getCoverageSummary(snapshotId, type = null) {
    const url = type
        ? `${BASE_URL}/coverage/${snapshotId}/summary?type=${encodeURIComponent(type)}`
        : `${BASE_URL}/coverage/${snapshotId}/summary`;
    const res = await editorAwareFetch(
        url,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function getSystemCoverageSummary(snapshotId) {
    const res = await editorAwareFetch(
        `${BASE_URL}/coverage/${snapshotId}/system/summary`,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function getCoverageFiles(
    snapshotId,
    {
        sortBy = "filePath",
        order = "asc",
        page = 1,
        limit = 200,
        type = null,
    } = {}
) {
    const params = new URLSearchParams({
        sortBy,
        order,
        page,
        limit,
    });
    if (type) {
        params.append("type", type);
    }

    const res = await editorAwareFetch(
        `${BASE_URL}/coverage/${snapshotId}/files?${params}`,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function runSupertestCoverage(snapshotId) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/supertest/run`, {
        method: "POST",
        headers: getAuthHeaders(),
    });

    return handleResponse(res);
}

export async function getTestExecution(snapshotId) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/test-execution`, {
        headers: getAuthHeaders(),
    });

    return handleResponse(res);
}

export async function getCoverageFrameworks(snapshotId) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/frameworks`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function runCoverageByType(snapshotId, coverageType, framework, executionMode, options = {}) {
    const headers = getAuthHeaders();
    const isRestart = Boolean(options?.restart);
    const useHermeticMock = Boolean(options?.useHermeticMock);
    const bodyPayload = {
        ...(framework ? { framework } : {}),
        ...(executionMode ? { executionMode } : {}),
        ...(isRestart ? { restart: true } : {}),
        ...(useHermeticMock ? { useHermeticMock: true } : {}),
        ...(options?.targetEndpoint ? { targetEndpoint: options.targetEndpoint } : {}),
        ...(Array.isArray(options?.targetTestNames) && options.targetTestNames.length > 0
            ? { targetTestNames: options.targetTestNames }
            : {}),
        ...(Array.isArray(options?.selectedScenarioIds) && options.selectedScenarioIds.length > 0
            ? { selectedScenarioIds: options.selectedScenarioIds }
            : {}),
    };
    const hasBody = Object.keys(bodyPayload).length > 0;
    const url = isRestart
        ? `${BASE_URL}/coverage/${snapshotId}/${coverageType}/run?restart=true`
        : `${BASE_URL}/coverage/${snapshotId}/${coverageType}/run`;
    const res = await editorAwareFetch(url, {
        method: "POST",
        headers: hasBody ? { ...headers, "Content-Type": "application/json" } : headers,
        body: hasBody ? JSON.stringify(bodyPayload) : undefined,
    });
    return handleResponse(res);
}

export async function getSystemTestEvidence(snapshotId, scenarioId, signal) {
    const response = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/system/scenarios/${scenarioId}/evidence`, {headers:getAuthHeaders(),signal});
    if (!response.ok) throw new Error('Evidence could not be loaded');
    return response.blob();
}

export async function installMissingDependency(snapshotId, packageName, isDev = false, rerunTests = true, importedFrom = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEPENDENCY_INSTALL_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/install-dependency`, {
            method: "POST",
            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ packageName, isDev, rerunTests, ...(importedFrom ? { importedFrom } : {}) }),
            signal: controller.signal,
        });
        return await handleResponse(res);
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error(`The installation request for '${packageName}' timed out. The server may still be finishing the installation; check the project status before retrying. No mock fallback has been enabled.`, { cause: err });
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

export async function getFileCoverage(snapshotId, filePath) {
    const res = await editorAwareFetch(
        `${BASE_URL}/coverage/${snapshotId}/file-coverage?filePath=${encodeURIComponent(filePath)}`,
        {
            headers: getAuthHeaders(),
        }
    );
    return handleResponse(res);
}

export async function suggestUnitTestcase(snapshotId, filePath, projectId, framework = null, validationMode = 'fast') {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/suggest-testcase`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ filePath, projectId, validationMode, ...(framework ? { framework } : {}) }),
    });
    return handleResponse(res);
}

export async function suggestAllUnitTestcases(snapshotId, { filePaths = [], projectId, framework = null, validationMode = 'full' } = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/suggest-testcase-all`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ filePaths, projectId, validationMode, ...(framework ? { framework } : {}) }),
    });
    return handleResponse(res);
}


export async function getCoverageFunctions(
    snapshotId,
    {
        filePath = "",
        sortBy = "filePath",
        order = "asc",
        page = 1,
        limit = 200,
        type = null,
    } = {}
) {
    const params = new URLSearchParams({
        sortBy,
        order,
        page,
        limit,
    });
    if (filePath) {
        params.set("filePath", filePath);
    }
    if (type) {
        params.append("type", type);
    }

    const res = await editorAwareFetch(
        `${BASE_URL}/coverage/${snapshotId}/functions?${params}`,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function getCoverageTestSuites(snapshotId, type = "unit") {
    const res = await editorAwareFetch(
        `${BASE_URL}/coverage/${snapshotId}/test-suites?type=${encodeURIComponent(type)}`,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function getIntegrationWorkspace(snapshotId) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/workspace`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function applyUnitTestSuggestion(snapshotId, { suggestion, suggestions, projectId, skipBackgroundJob, requireCoverageGoal, requestId } = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/apply-test-suggestion`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ suggestion, suggestions, projectId, skipBackgroundJob: Boolean(skipBackgroundJob), requireCoverageGoal, requestId }),
    });
    return handleResponse(res);
}

export async function applyAllUnitTestSuggestions(snapshotId, { suggestions = [], projectId, skipBackgroundJob } = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/apply-all-test-suggestions`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ suggestions, projectId, skipBackgroundJob: Boolean(skipBackgroundJob) }),
    });
    return handleResponse(res);
}


export async function saveAiSystemTest(snapshotId, options = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/system/save-ai-test`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(options),
    });
    return handleResponse(res);
}

export async function getIntegrationHistory(snapshotId) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/history`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function getIntegrationVersionHistory(snapshotId, options = {}) {
    const params = new URLSearchParams(options);
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/version-history${queryString}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function compareIntegrationVersions(snapshotId, versionAId, versionBId, type = "ANALYZE") {
    const params = new URLSearchParams({ versionAId, versionBId, type });
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/version-compare?${params.toString()}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function getHistoricalWorkspaceVersion(snapshotId, versionId, type = "ANALYZE") {
    const params = new URLSearchParams({ type });
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/version/${versionId}?${params.toString()}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function getBeforeAfterComparison(projectId, options = {}) {
    const cleanOptions = {};
    for (const [k, v] of Object.entries(options)) {
        if (v != null && v !== "") cleanOptions[k] = v;
    }
    const params = new URLSearchParams(cleanOptions);
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const res = await editorAwareFetch(`${BASE_URL}/coverage/project/${projectId}/comparison${queryString}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function getSourceFileDiff(projectId, options = {}) {
    const params = new URLSearchParams(options);
    const res = await editorAwareFetch(`${BASE_URL}/coverage/project/${projectId}/comparison/source-file?${params.toString()}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}



export async function getIntegrationDetection(snapshotId) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/frameworks`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function installIntegrationDependencies(snapshotId) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/install-dependencies`, {
        method: "POST",
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function generateIntegrationTests(snapshotId, { framework = "supertest", targetEndpoints = [], force = false } = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/generate-tests`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ framework, targetEndpoints, force }),
    });
    return handleResponse(res);
}

export async function regenerateIntegrationScenario(snapshotId, { scenarioId, framework, failureContext } = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/regenerate-scenario`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ scenarioId, framework, failureContext }),
    });
    return handleResponse(res);
}

export async function updateIntegrationScenario(snapshotId, scenarioId, updateData = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/scenarios/${scenarioId}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(updateData),
    });
    return handleResponse(res);
}

export async function applyIntegrationTests(snapshotId, { testIds = [], targetFilePath = "", fileName = "" } = {}) {
    const res = await editorAwareFetch(`${BASE_URL}/coverage/${snapshotId}/integration/apply-tests`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ testIds, targetFilePath, fileName }),
    });
    return handleResponse(res);
}

export async function getUnifiedQualityDashboard(snapshotId, options = {}) {
    const isRefresh = Boolean(options?.refresh || options?.bypassCache);
    const url = isRefresh
        ? `${BASE_URL}/coverage/${snapshotId}/unified-dashboard?refresh=true`
        : `${BASE_URL}/coverage/${snapshotId}/unified-dashboard`;
    const res = await editorAwareFetch(url, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function getUnifiedTestRunInspection(snapshotId, runId) {
    const res = await fetch(
        `${BASE_URL}/coverage/${snapshotId}/unified-dashboard/runs/${encodeURIComponent(runId)}`,
        {
            headers: getAuthHeaders(),
        }
    );
    return handleResponse(res);
}

export async function getSuitesReadiness(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/suites-readiness`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function approveIntegrationScenarios(snapshotId, { approvedTestIds = [], approveAll = false } = {}) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/integration/approve`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ approvedTestIds, approveAll }),
    });
    return handleResponse(res);
}

export async function confirmBatchSystemScenarios(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/system/scenarios/confirm-batch`, {
        method: "POST",
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function getUnitTestVersions(snapshotId, filePath = null) {
    const query = filePath ? `?filePath=${encodeURIComponent(filePath)}` : "";
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/unit-test-versions${query}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function switchUnitTestVersion(snapshotId, {
    projectId,
    filePath,
    targetVersion,
    targetVersionId,
    allFiles = false,
    targetVersionType = null,
    runTests = true
} = {}) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/unit-test-versions/switch`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
            projectId,
            filePath,
            targetVersion,
            targetVersionId,
            allFiles,
            targetVersionType,
            runTests
        }),
    });
    return handleResponse(res);
}

export async function saveUnitTestVersions(snapshotId, payload = {}) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/unit-test-versions/save`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse(res);
}

export async function getUnitTestSimulationSources(snapshotId, options = {}) {
    const params = new URLSearchParams();
    if (options && typeof options === "object") {
        for (const [key, value] of Object.entries(options)) {
            if (value !== undefined && value !== null) {
                params.set(key, String(value));
            }
        }
    }
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/simulation/sources${queryString}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function getUnitTestSimulationTrace(snapshotId, payload = {}) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/simulation/trace`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse(res);
}
