import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const getAuthHeaders = () => {
  const user = localStorage.getItem("user");
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem("token") || userToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Fetch detected system test frameworks and tests status for a project/snapshot
 */
export const getSystemTestFrameworks = async (projectId, snapshotId = null) => {
  const params = new URLSearchParams();
  if (snapshotId) {
    params.append("snapshotId", snapshotId);
  }
  const headers = getAuthHeaders();
  const response = await axios.get(
    `${API_BASE}/projects/${projectId}/system-test/frameworks?${params.toString()}`,
    { headers }
  );
  return response.data;
};

/**
 * Trigger full or targeted system test execution
 */
export const runSystemTest = async (
  snapshotId,
  { framework = "playwright", executionMode = "frontend", testFile = null } = {}
) => {
  const headers = getAuthHeaders();
  const response = await axios.post(
    `${API_BASE}/coverage/${snapshotId}/system/run`,
    { framework, executionMode, testFile },
    { headers }
  );
  return response.data;
};

/**
 * Backward compatibility aliases
 */
export const runPlaywrightTests = (projectId, snapshotId) =>
  runSystemTest(snapshotId, { framework: "playwright" });

export const runCypressTests = (projectId, snapshotId) =>
  runSystemTest(snapshotId, { framework: "cypress" });

export const runSystemTestAnalysis = (projectId, snapshotId, runner = null) =>
  runSystemTest(snapshotId, { framework: runner || "playwright" });

/**
 * Fetch system test execution summary and coverage metrics
 */
export const getSystemTestSummary = async (snapshotId) => {
  const headers = getAuthHeaders();
  const response = await axios.get(
    `${API_BASE}/coverage/${snapshotId}/system/summary`,
    { headers }
  );
  return response.data;
};

/**
 * Fetch hierarchical scenarios list grouped by test files with breakpoint details
 */
export const getSystemTestScenarios = async (snapshotId, params = {}) => {
  const headers = getAuthHeaders();
  const response = await axios.get(
    `${API_BASE}/coverage/${snapshotId}/system/scenarios`,
    { headers, params }
  );
  return response.data;
};

/**
 * Fetch screenshot or DOM snapshot evidence for a scenario
 */
export const getSystemTestEvidence = async (
  snapshotId,
  scenarioId,
  format = "image"
) => {
  const headers = getAuthHeaders();
  if (format === "dom" || format === "json") {
    const response = await axios.get(
      `${API_BASE}/coverage/${snapshotId}/system/scenarios/${scenarioId}/evidence?format=${format}`,
      { headers }
    );
    return response.data;
  }

  const response = await axios.get(
    `${API_BASE}/coverage/${snapshotId}/system/scenarios/${scenarioId}/evidence`,
    {
      headers,
      responseType: "blob",
    }
  );
  return response.data;
};

/**
 * Generate cold-start system tests for projects with 0 tests
 */
export const generateColdStartSystemTests = async (
  snapshotId,
  { framework = "playwright", routes = ["/"] } = {}
) => {
  const headers = getAuthHeaders();
  const response = await axios.post(
    `${API_BASE}/coverage/${snapshotId}/system/generate-tests`,
    { framework, routes },
    { headers }
  );
  return response.data;
};

/**
 * Read test file content from disk
 */
export const getSystemTestFileContent = async (snapshotId, filePath) => {
  const headers = getAuthHeaders();
  const response = await axios.get(
    `${API_BASE}/coverage/${snapshotId}/system/tests/content?filePath=${encodeURIComponent(
      filePath
    )}`,
    { headers }
  );
  return response.data;
};

/**
 * Update test file content on disk and database
 */
export const updateSystemTestFileContent = async (
  snapshotId,
  filePath,
  content
) => {
  const headers = getAuthHeaders();
  const response = await axios.put(
    `${API_BASE}/coverage/${snapshotId}/system/tests/content`,
    { filePath, content },
    { headers }
  );
  return response.data;
};

/**
 * Execute a single test file quickly
 */
export const runSingleSystemTest = async (
  snapshotId,
  filePath,
  framework = "playwright"
) => {
  const headers = getAuthHeaders();
  const response = await axios.post(
    `${API_BASE}/coverage/${snapshotId}/system/tests/run-single`,
    { filePath, framework },
    { headers }
  );
  return response.data;
};

/**
 * AI optimize test: Boost coverage or Fix breakpoint
 */
export const optimizeSystemTest = async (
  snapshotId,
  { filePath, scenarioId = null, mode = "BOOST_COVERAGE", instruction = "" }
) => {
  const headers = getAuthHeaders();
  const response = await axios.post(
    `${API_BASE}/coverage/${snapshotId}/system/optimize-test`,
    { filePath, scenarioId, mode, instruction },
    { headers }
  );
  return response.data;
};


