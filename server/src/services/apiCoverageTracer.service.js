import { normalizeFilePath } from "./unifiedCoverageEngine.service.js";

/**
 * Reverse API Coverage & Failure Layer Diagnostic Tracer (CovAI)
 * 
 * Maps line-by-line runtime coverage data back to API Endpoints,
 * routes, middlewares, controllers, and database interactions.
 * Diagnoses failure layers (Router, Middleware, Controller, Database, Assertion)
 * when integration tests fail.
 */

/**
 * Helper to calculate percentage safely.
 */
const safePct = (covered, total) => {
    if (!total || total === 0) return 100;
    return Number(((covered / total) * 100).toFixed(2));
};

/**
 * Extracts a line snippet from source code array if available.
 */
const extractSnippetAtLine = (sourceCode = [], filePath = "", line = 1, contextLines = 2) => {
    if (!filePath || !sourceCode || !Array.isArray(sourceCode) || sourceCode.length === 0) return "";
    const normTarget = normalizeFilePath(filePath);
    const file = sourceCode.find((f) => normalizeFilePath(f.path) === normTarget || f.path.endsWith(normTarget));
    if (!file || !file.content) return "";

    const lines = file.content.split("\n");
    const start = Math.max(0, line - 1 - contextLines);
    const end = Math.min(lines.length, line + contextLines);
    return lines.slice(start, end).join("\n");
};

/**
 * Finds the last executed line inside a line range for a covered file.
 *
 * @param {Object} fileCoverage - Normalized file coverage object
 * @param {number} startLine - Start line of handler
 * @param {number} endLine - End line of handler
 * @param {Array} [sourceCode] - Source code array
 * @returns {{ line: number, hits: number, codeSnippet: string } | null}
 */
export const findLastExecutedLine = (fileCoverage, startLine = 1, endLine = 100, sourceCode = []) => {
    if (!fileCoverage || !fileCoverage.lineHits) return null;

    let lastHitLine = null;
    let maxHits = 0;

    for (let l = startLine; l <= endLine; l++) {
        const hits = fileCoverage.lineHits[l] || 0;
        if (hits > 0) {
            lastHitLine = l;
            maxHits = hits;
        }
    }

    if (!lastHitLine) return null;

    return {
        line: lastHitLine,
        hits: maxHits,
        codeSnippet: extractSnippetAtLine(sourceCode, fileCoverage.filePath, lastHitLine, 1),
    };
};

/**
 * Matches an endpoint's controller file to a file in fileCoverageMap.
 * Supports exact paths and fuzzy relative suffix matches.
 */
const findFileCoverage = (controllerFile, fileCoverageMap = {}) => {
    if (!controllerFile) return null;
    const norm = normalizeFilePath(controllerFile);

    if (fileCoverageMap[norm]) return fileCoverageMap[norm];

    for (const [key, val] of Object.entries(fileCoverageMap)) {
        const normKey = normalizeFilePath(key);
        if (normKey === norm || normKey.endsWith(norm) || norm.endsWith(normKey)) {
            return val;
        }
    }

    return null;
};

/**
 * Maps runtime coverage data across all API endpoints.
 * Determines if each API endpoint is COVERED, PARTIAL, or UNCOVERED,
 * along with exact line metrics and missing branch conditions.
 *
 * @param {Object} params
 * @param {Array<Object>} params.endpoints - API endpoints list from apiEndpointParser.service.js
 * @param {Object} params.fileCoverageMap - Map of normalized file records from parseUnifiedCoverage
 * @param {Array<Object>} [params.sourceCode] - Optional source code files
 * @returns {{ endpointsTraceability: Array<Object>, summary: Object }}
 */
export const traceApiEndpointCoverage = ({ endpoints = [], fileCoverageMap = {}, sourceCode = [] } = {}) => {
    const endpointsTraceability = [];

    let totalEndpoints = endpoints.length;
    let coveredEndpoints = 0;
    let partialEndpoints = 0;
    let uncoveredEndpoints = 0;

    for (const ep of endpoints) {
        const method = (ep.method || "GET").toUpperCase();
        const routePath = ep.path || "/";
        const controllerFile = ep.controllerFile || "";

        let lineStart = ep.controllerLineStart || ep.controllerLine || 1;
        let lineEnd = ep.controllerLineEnd || (lineStart + 20);

        const fileCov = findFileCoverage(controllerFile, fileCoverageMap);

        if (!fileCov) {
            // No coverage artifact or file never executed
            endpointsTraceability.push({
                method,
                path: routePath,
                controllerFile,
                controllerLineStart: lineStart,
                controllerLineEnd: lineEnd,
                status: "UNCOVERED",
                coveragePct: 0,
                coveredLinesCount: 0,
                totalLinesCount: 0,
                uncoveredLines: [],
                missingBranches: [],
                middlewares: ep.middlewares || [],
                serviceLayer: ep.serviceLayer || null,
            });
            uncoveredEndpoints++;
            continue;
        }

        // If controllerLine was provided without precise end line, attempt lookup from fnMap
        if (!ep.controllerLineEnd && fileCov.functions && fileCov.functions.length > 0) {
            const matchedFn = fileCov.functions.find(
                (f) => f.startLine <= lineStart && lineStart <= f.endLine
            );
            if (matchedFn) {
                lineStart = matchedFn.startLine;
                lineEnd = matchedFn.endLine;
            }
        }

        // Scan lines in [lineStart, lineEnd]
        let linesTracked = 0;
        let linesCovered = 0;
        const uncoveredLines = [];

        for (let l = lineStart; l <= lineEnd; l++) {
            if (fileCov.lineHits && typeof fileCov.lineHits[l] === "number") {
                linesTracked++;
                if (fileCov.lineHits[l] > 0) {
                    linesCovered++;
                } else {
                    uncoveredLines.push(l);
                }
            }
        }

        // Scan uncovered branches located inside handler range
        const missingBranches = (fileCov.uncoveredBranches || []).filter(
            (b) => b.line >= lineStart && b.line <= lineEnd
        ).map((b) => ({
            line: b.line,
            type: b.type,
            missingPaths: b.missingPaths,
            totalPaths: b.totalPaths,
        }));

        let pct = safePct(linesCovered, linesTracked);
        let status = "UNCOVERED";

        if (linesTracked === 0) {
            // Statements might be minimal; check if file or handler function has hits
            const fnHit = (fileCov.functions || []).find((f) => f.startLine === lineStart)?.hit || 0;
            if (fnHit > 0) {
                status = "COVERED";
                pct = 100;
            } else {
                status = "UNCOVERED";
                pct = 0;
            }
        } else if (linesCovered === 0) {
            status = "UNCOVERED";
            pct = 0;
        } else if (linesCovered === linesTracked && missingBranches.length === 0) {
            status = "COVERED";
            pct = 100;
        } else {
            status = "PARTIAL";
        }

        if (status === "COVERED") coveredEndpoints++;
        else if (status === "PARTIAL") partialEndpoints++;
        else uncoveredEndpoints++;

        endpointsTraceability.push({
            method,
            path: routePath,
            controllerFile: fileCov.filePath || controllerFile,
            controllerLineStart: lineStart,
            controllerLineEnd: lineEnd,
            status,
            coveragePct: pct,
            coveredLinesCount: linesCovered,
            totalLinesCount: linesTracked,
            uncoveredLines,
            missingBranches,
            middlewares: ep.middlewares || [],
            serviceLayer: ep.serviceLayer || null,
        });
    }

    const endpointCoveragePct = safePct(coveredEndpoints, totalEndpoints);
    const effectiveCoveragePct = safePct(
        coveredEndpoints + 0.5 * partialEndpoints,
        totalEndpoints
    );

    return {
        endpointsTraceability,
        summary: {
            totalEndpoints,
            coveredEndpoints,
            partialEndpoints,
            uncoveredEndpoints,
            endpointCoveragePct,
            effectiveCoveragePct,
        },
    };
};

/**
 * Diagnoses the specific failure layer for a failing API test scenario.
 * Pinpoints whether the failure occurred at:
 * - ROUTER_NOT_FOUND (404 / Route unmounted)
 * - MIDDLEWARE_REJECTED (401/403 Auth or Validation error)
 * - DATABASE_FAILURE (Database query error, Prisma/Mongoose exception, connection dropped)
 * - CONTROLLER_CRASH (500 Uncaught exception in controller handler)
 * - ASSERTION_FAILED (Handler finished successfully, but response contract differed)
 *
 * @param {Object} params
 * @param {Object} params.endpoint - API endpoint definition
 * @param {Object} params.scenario - Test scenario with failure information
 * @param {Array<string>} [params.failureMessages] - Raw test failure messages
 * @param {Object} [params.fileCoverageMap] - Map of normalized file records
 * @param {Array<Object>} [params.sourceCode] - Source code array
 * @returns {Object} Structured diagnostic report
 */
export const diagnoseApiFailureLayer = ({
    endpoint = {},
    scenario = {},
    failureMessages = [],
    fileCoverageMap = {},
    sourceCode = [],
} = {}) => {
    const rawErrors = [
        scenario.errorMessage || "",
        scenario.errorStack || "",
        ...(failureMessages || []),
    ].join("\n");

    const actualStatus = Number(scenario.actualStatus || scenario.status || 0);
    const expectedStatus = Number(scenario.expectedStatus || 200);

    const controllerFile = endpoint.controllerFile || "";
    const lineStart = endpoint.controllerLineStart || endpoint.controllerLine || 1;
    const lineEnd = endpoint.controllerLineEnd || (lineStart + 25);
    const fileCov = findFileCoverage(controllerFile, fileCoverageMap);

    const lastExecuted = fileCov ? findLastExecutedLine(fileCov, lineStart, lineEnd, sourceCode) : null;

    // Check statements hit inside controller
    let controllerStatementsHit = 0;
    if (fileCov && fileCov.lineHits) {
        for (let l = lineStart; l <= lineEnd; l++) {
            if ((fileCov.lineHits[l] || 0) > 0) {
                controllerStatementsHit++;
            }
        }
    }

    // 1. ROUTER_NOT_FOUND
    const isRouterNotFound =
        actualStatus === 404 && expectedStatus !== 404 ||
        /cannot (get|post|put|delete|patch)|route not found|no route matched|404 not found/i.test(rawErrors) ||
        (controllerStatementsHit === 0 && actualStatus === 404);

    if (isRouterNotFound) {
        return {
            failureLayer: "ROUTER_NOT_FOUND",
            explanation: `Yêu cầu API tới '${endpoint.method || "GET"} ${endpoint.path || "/"}' trả về mã 404 hoặc không tìm thấy route handler. Không có dòng code controller nào được kích hoạt.`,
            failingComponent: endpoint.routeFile || "Express Router",
            lastExecutedLine: null,
            suggestedFix: "Kiểm tra lại cấu hình `app.use()` prefix và phương thức HTTP/URL path trong router file.",
            diagnosticsDetails: {
                actualStatus,
                expectedStatus,
                controllerEntered: false,
                routeFile: endpoint.routeFile || null,
            },
        };
    }

    // 2. MIDDLEWARE_REJECTED
    // Check if middleware statements were hit or status is 401/403/validation
    const isAuthOrForbidden = (actualStatus === 401 && expectedStatus !== 401) ||
                              (actualStatus === 403 && expectedStatus !== 403);
    const isValidationError = (actualStatus === 422 || (actualStatus === 400 && expectedStatus !== 400)) &&
                              /validation|schema|invalid parameter|required field|joi|zod/i.test(rawErrors);
    const isMiddlewareKeyword = /unauthorized|forbidden|jwt expired|invalid token|cors|csrf|rate limit/i.test(rawErrors);

    // If controller was never entered, but status is rejected or auth error
    if (isAuthOrForbidden || isValidationError || isMiddlewareKeyword || (controllerStatementsHit === 0 && (actualStatus >= 400 && actualStatus < 500))) {
        const mwName = (endpoint.middlewares && endpoint.middlewares[0]?.name) || "Auth/Validation Middleware";
        return {
            failureLayer: "MIDDLEWARE_REJECTED",
            explanation: `Request bị chặn tại tầng Middleware (${mwName}) trước khi tiến vào Controller. Mã lỗi: ${actualStatus || 401}.`,
            failingComponent: mwName,
            lastExecutedLine: null,
            suggestedFix: "Bổ sung Bearer Token, API Key hoặc kiểm tra body schema/headers phù hợp với yêu cầu của middleware.",
            diagnosticsDetails: {
                actualStatus,
                expectedStatus,
                controllerEntered: false,
                middlewares: endpoint.middlewares || [],
            },
        };
    }

    // 3. DATABASE_FAILURE
    const isDbError =
        /prisma.*error|prismaclient|p2002|p2025|mongo(ose)?error|econnrefused|connect econnrefused|unique constraint|foreign key constraint|sequelize|knex|sqlite|database connection/i.test(rawErrors) ||
        (lastExecuted && /(prisma|db\.|mongoose|query\(|await\s+db|knex)/i.test(lastExecuted.codeSnippet || ""));

    if (isDbError) {
        return {
            failureLayer: "DATABASE_FAILURE",
            explanation: `Xảy ra lỗi tương tác cơ sở dữ liệu (Database Query / Connection Error). Điểm dừng gần nhất tại dòng ${lastExecuted ? lastExecuted.line : lineStart}.`,
            failingComponent: controllerFile || "Database Layer",
            lastExecutedLine: lastExecuted,
            suggestedFix: "Đảm bảo database test đang chạy, kết nối DATABASE_URL hợp lệ, và dữ liệu tham chiếu (foreign key/seed) tồn tại trước khi chạy test.",
            diagnosticsDetails: {
                actualStatus,
                expectedStatus,
                controllerEntered: true,
                rawErrorMessage: rawErrors.split("\n")[0] || null,
            },
        };
    }

    // 4. CONTROLLER_CRASH
    const isControllerCrash =
        actualStatus === 500 ||
        /typeerror|referenceerror|rangeerror|syntaxerror|unhandledpromiserejection/i.test(rawErrors) ||
        (controllerStatementsHit > 0 && actualStatus >= 500);

    if (isControllerCrash) {
        return {
            failureLayer: "CONTROLLER_CRASH",
            explanation: `Controller bị crash do biệt lệ không được bắt (Unhandled Exception). Luồng thực thi bị ngắt tại dòng ${lastExecuted ? lastExecuted.line : lineStart}.`,
            failingComponent: controllerFile || "Controller Handler",
            lastExecutedLine: lastExecuted,
            suggestedFix: "Thêm try-catch hoặc kiểm tra các giá trị undefined/null trước khi truy cập thuộc tính trong controller.",
            diagnosticsDetails: {
                actualStatus,
                expectedStatus,
                controllerEntered: true,
                lastExecutedLine: lastExecuted ? lastExecuted.line : null,
                crashSnippet: lastExecuted ? lastExecuted.codeSnippet : null,
            },
        };
    }

    // 5. ASSERTION_FAILED
    const isAssertion =
        /assertionerror|expected|received|toequal|tobetruthy|tobefalsy|expect\(/i.test(rawErrors) ||
        (actualStatus > 0 && expectedStatus > 0 && actualStatus !== expectedStatus) ||
        (controllerStatementsHit > 0 && actualStatus >= 200 && actualStatus < 300);

    if (isAssertion) {
        return {
            failureLayer: "ASSERTION_FAILED",
            explanation: `Request hoàn thành trọn vẹn luồng backend, nhưng response trả về khác với kỳ vọng của test case. (Kỳ vọng: ${expectedStatus}, Thực tế: ${actualStatus}).`,
            failingComponent: "Test Assertion / Contract",
            lastExecutedLine: lastExecuted,
            suggestedFix: "Cập nhật kỳ vọng trong kịch bản kiểm thử hoặc điều chỉnh schema payload phản hồi từ controller cho đúng chuẩn.",
            diagnosticsDetails: {
                actualStatus,
                expectedStatus,
                controllerEntered: true,
            },
        };
    }

    // Default Fallback
    return {
        failureLayer: "UNKNOWN_ERROR",
        explanation: `Test case thất bại do lỗi không xác định. (Status: ${actualStatus || "N/A"}).`,
        failingComponent: controllerFile || "System Pipeline",
        lastExecutedLine: lastExecuted,
        suggestedFix: "Kiểm tra log chi tiết của test runner để biết thêm thông tin.",
        diagnosticsDetails: {
            actualStatus,
            expectedStatus,
            rawErrors: rawErrors.substring(0, 300),
        },
    };
};

/**
 * Builds a comprehensive Integration Test & API Coverage Report.
 * Consolidates endpoint traceability, diagnostics for failed scenarios,
 * and lists uncovered endpoints requiring AI generation.
 *
 * @param {Object} params
 * @param {Array<Object>} params.endpoints - All extracted API endpoints
 * @param {Object} params.coverageData - Raw or parsed coverage data
 * @param {Array<Object>} [params.scenarios] - Executed test scenarios
 * @param {Array<Object>} [params.sourceCode] - Source code files
 * @returns {Object} Comprehensive integration coverage report
 */
export const buildApiCoverageReport = ({
    endpoints = [],
    coverageData = null,
    traceabilityResult = null,
    scenarios = [],
    sourceCode = [],
    testFramework = "SUPERTEST",
} = {}) => {
    let traceResult = traceabilityResult;
    let fileCoverageMap = {};
    if (!traceResult) {
        if (coverageData) {
            fileCoverageMap = coverageData.files || coverageData;
        }
        traceResult = traceApiEndpointCoverage({
            endpoints,
            fileCoverageMap,
            sourceCode,
        });
    }

    const { endpointsTraceability = [], summary = {} } = traceResult;

    const failedScenariosDiagnostics = [];
    for (const scenario of scenarios) {
        const scStatus = String(scenario.status || "").toUpperCase();
        if (scStatus === "FAILED" || scStatus === "ERROR" || scenario.failed) {
            // Match with endpoint
            const matchedEp = endpoints.find(
                (e) => e.path === scenario.endpoint || e.path === scenario.url || (scenario.title && scenario.title.includes(e.path))
            ) || { path: scenario.endpoint || scenario.url || "unknown", method: scenario.method || "GET" };

            const diag = diagnoseApiFailureLayer({
                endpoint: matchedEp,
                scenario,
                failureMessages: scenario.failureMessages || [],
                fileCoverageMap,
                sourceCode,
            });

            failedScenariosDiagnostics.push({
                scenarioId: scenario.id || scenario.title || "scenario",
                title: scenario.title || "Failing Test Scenario",
                endpoint: `${matchedEp.method || "GET"} ${matchedEp.path || "/"}`,
                ...diag,
            });
        }
    }

    const uncoveredEndpointsList = endpointsTraceability.filter(
        (ep) => ep.status === "UNCOVERED" || ep.status === "PARTIAL"
    );

    const recommendations = [];
    if (uncoveredEndpointsList.length > 0) {
        recommendations.push(`Cần bổ sung test case cho ${uncoveredEndpointsList.length} API endpoint chưa được kích hoạt logic controller.`);
    }
    if (failedScenariosDiagnostics.length > 0) {
        recommendations.push(`Có ${failedScenariosDiagnostics.length} kịch bản test bị fail cần phân tích và sửa lỗi.`);
    }

    return {
        metadata: {
            testFramework,
            generatedAt: new Date().toISOString(),
        },
        metrics: {
            ...summary,
            coveragePct: summary.endpointCoveragePct ?? 0,
        },
        summary: {
            ...summary,
            coveragePct: summary.endpointCoveragePct ?? 0,
            totalScenarios: scenarios.length,
            passedScenarios: scenarios.filter((s) => s.status === "PASSED" || s.status === "passed" || s.passed).length,
            failedScenarios: failedScenariosDiagnostics.length,
        },
        routeMatrix: endpointsTraceability,
        endpointsTraceability,
        failedScenariosDiagnostics,
        uncoveredEndpoints: uncoveredEndpointsList,
        uncoveredList: uncoveredEndpointsList,
        recommendations,
    };
};

