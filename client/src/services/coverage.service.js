const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
    const user = localStorage.getItem("user");
    const userToken = user ? JSON.parse(user).token : null;
    const token = localStorage.getItem("token") || userToken;

    return {
        "Content-Type": "application/json",
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

        throw new Error(data.message || "Failed API call");
    }

    return data;
}

export async function getCoverageSummary(snapshotId) {
    const res = await fetch(
        `${BASE_URL}/coverage/${snapshotId}/summary`,
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
    } = {}
) {
    const params = new URLSearchParams({
        sortBy,
        order,
        page,
        limit,
    });

    const res = await fetch(
        `${BASE_URL}/coverage/${snapshotId}/files?${params}`,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function runSupertestCoverage(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/supertest/run`, {
        method: "POST",
        headers: getAuthHeaders(),
    });

    return handleResponse(res);
}

export async function getTestExecution(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/test-execution`, {
        headers: getAuthHeaders(),
    });

    return handleResponse(res);
}

export async function getCoverageFrameworks(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/frameworks`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

export async function runCoverageByType(snapshotId, coverageType, framework) {
    const headers = getAuthHeaders();
    const options = {
        method: "POST",
        headers: framework ? { ...headers, "Content-Type": "application/json" } : headers,
        body: framework ? JSON.stringify({ framework }) : undefined,
    };
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/${coverageType}/run`, options);
    return handleResponse(res);
}

export async function getFileCoverage(snapshotId, filePath) {
    const res = await fetch(
        `${BASE_URL}/coverage/${snapshotId}/file-coverage?filePath=${encodeURIComponent(filePath)}`,
        {
            headers: getAuthHeaders(),
        }
    );
    return handleResponse(res);
}

export async function suggestUnitTestcase(snapshotId, filePath, projectId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/suggest-testcase`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ filePath, projectId }),
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

    const res = await fetch(
        `${BASE_URL}/coverage/${snapshotId}/functions?${params}`,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function getCoverageTestSuites(snapshotId, type = "unit") {
    const res = await fetch(
        `${BASE_URL}/coverage/${snapshotId}/test-suites?type=${encodeURIComponent(type)}`,
        {
            headers: getAuthHeaders(),
        }
    );

    return handleResponse(res);
}

export async function getIntegrationWorkspace(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/integration/workspace`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}
