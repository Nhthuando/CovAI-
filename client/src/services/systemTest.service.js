import { getAIModelHeaders } from './aiModel.service.js';
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const getAuthHeaders = () => {
  const user = localStorage.getItem("user");
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem("token") || userToken;
  return { ...getAIModelHeaders(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
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
export const getSystemTestSummary = async (snapshotId, params = {}) => {
  const headers = getAuthHeaders();
  const response = await axios.get(
    `${API_BASE}/coverage/${snapshotId}/system/summary`,
    { headers, params }
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
  format = "image",
  { signal } = {}
) => {
  const headers = getAuthHeaders();
  if (format === "dom" || format === "json") {
    const response = await axios.get(
      `${API_BASE}/coverage/${snapshotId}/system/scenarios/${scenarioId}/evidence?type=dom`,
      { headers, signal, timeout: 15000 }
    );
    return response.data;
  }

  const response = await axios.get(
    `${API_BASE}/coverage/${snapshotId}/system/scenarios/${scenarioId}/evidence?type=screenshot`,
    {
      headers: { ...headers, Accept: "image/png" },
      responseType: "blob",
      signal,
      timeout: 15000,
    }
  );
  if (!response.data?.type?.startsWith("image/")) {
    throw new Error("Screenshot unavailable for this scenario");
  }
  return response.data;
};

/**
 * Generate cold-start system tests for projects with 0 tests
 */
export const generateColdStartSystemTests = async (
  snapshotId,
  { framework = "playwright", routes = ["/"], executionMode = "frontend" } = {}
) => {
  const headers = getAuthHeaders();
  const response = await axios.post(
    `${API_BASE}/coverage/${snapshotId}/system/generate-tests`,
    { framework, routes, executionMode },
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
  content,
  options = {}
) => {
  const headers = getAuthHeaders();
  const response = await axios.put(
    `${API_BASE}/coverage/${snapshotId}/system/tests/content`,
    { filePath, content, ...options, requestId: options.requestId || crypto.randomUUID() },
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
  framework = "playwright",
  executionMode = "frontend"
) => {
  const headers = getAuthHeaders();
  const response = await axios.post(
    `${API_BASE}/coverage/${snapshotId}/system/tests/run-single`,
    { filePath, framework, executionMode },
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

export const systemEvidenceRequest = async (snapshotId, path, { method = 'GET', data } = {}) => {
  const response = await axios({ url: `${API_BASE}/coverage/${snapshotId}/system/${path}`, method, data, headers: getAuthHeaders() });
  return response.data.data;
};

export const getSystemRunArtifact = async (snapshotId, artifactId, { signal } = {}) => {
  const response = await axios.get(`${API_BASE}/coverage/${snapshotId}/system/artifacts/${encodeURIComponent(artifactId)}`, { headers: getAuthHeaders(), responseType: 'blob', signal });
  return response.data;
};

export const downloadSystemAssessmentPdf = async (snapshotId, assessmentId) => {
  const response = await axios.get(`${API_BASE}/coverage/${snapshotId}/system/assessments/${assessmentId}/report.pdf`, { headers: getAuthHeaders(), responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `covai-system-test-${assessmentId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
};


