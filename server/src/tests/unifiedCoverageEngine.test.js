import {
    normalizeFilePath,
    normalizeFileCoverage,
    parseUnifiedCoverage,
    getLineExecutionStatus,
    formatCoverageForGutter,
    traceUnitCoverage,
    traceSystemCoverage,
} from "../services/unifiedCoverageEngine.service.js";

import {
    findLastExecutedLine,
    traceApiEndpointCoverage,
    diagnoseApiFailureLayer,
    buildApiCoverageReport,
} from "../services/apiCoverageTracer.service.js";

describe("Unified Coverage Engine & Line Tracing Specification", () => {
    describe("Task CE-1: Core Instrument & Flag Collection (unifiedCoverageEngine)", () => {
        it("should correctly normalize file paths across OS and container boundaries", () => {
            expect(normalizeFilePath("E:\\Express\\CovAI-\\server\\src\\app.js", "E:\\Express\\CovAI-")).toBe("server/src/app.js");
            expect(normalizeFilePath("/storage/projects/test/123/repo/server/src/routes.js")).toBe("server/src/routes.js");
            expect(normalizeFilePath("C:/workspace/repo/src/index.js")).toBe("src/index.js");
        });

        it("should normalize raw Istanbul coverage into standardized line hits and branch states", () => {
            const rawIstanbulFile = {
                path: "src/controllers/order.controller.js",
                statementMap: {
                    "0": { start: { line: 2, column: 4 }, end: { line: 2, column: 35 } },
                    "1": { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                    "2": { start: { line: 4, column: 8 }, end: { line: 4, column: 60 } },
                    "3": { start: { line: 6, column: 4 }, end: { line: 6, column: 50 } },
                    "4": { start: { line: 7, column: 4 }, end: { line: 7, column: 30 } },
                },
                s: {
                    "0": 1,
                    "1": 1,
                    "2": 1,
                    "3": 0,
                    "4": 0,
                },
                branchMap: {
                    "0": {
                        loc: { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                        type: "if",
                        locations: [
                            { start: { line: 4, column: 8 }, end: { line: 4, column: 60 } },
                            { start: { line: 6, column: 4 }, end: { line: 7, column: 30 } },
                        ],
                    },
                },
                b: {
                    "0": [1, 0],
                },
                fnMap: {
                    "0": {
                        name: "createOrder",
                        decl: { start: { line: 1, column: 13 }, end: { line: 1, column: 24 } },
                        loc: { start: { line: 1, column: 38 }, end: { line: 8, column: 1 } },
                    },
                },
                f: {
                    "0": 1,
                },
            };

            const norm = normalizeFileCoverage("src/controllers/order.controller.js", rawIstanbulFile);

            expect(norm.filePath).toBe("src/controllers/order.controller.js");
            expect(norm.coveredLines).toEqual([2, 3, 4, 5]);
            expect(norm.uncoveredLines).toEqual([6, 7]);
            expect(norm.uncoveredBranches).toHaveLength(1);
            expect(norm.uncoveredBranches[0].missingPaths).toEqual([1]);
            expect(norm.functions).toHaveLength(1);
            expect(norm.functions[0].name).toBe("createOrder");
            expect(norm.functions[0].isCovered).toBe(true);
            expect(norm.metrics.linesPct).toBe(66.67);
        });

        it("should parse an in-memory unified coverage bundle and compute overall summaries", () => {
            const rawBundle = {
                "src/utils/math.js": {
                    path: "src/utils/math.js",
                    statementMap: {
                        "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
                    },
                    s: { "0": 2 },
                    branchMap: {},
                    b: {},
                    fnMap: {
                        "0": { name: "add", decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
                    },
                    f: { "0": 2 },
                },
            };

            const parsed = parseUnifiedCoverage(rawBundle);
            expect(parsed.summary.linesPct).toBe(100);
            expect(parsed.summary.statementsPct).toBe(100);
            expect(parsed.summary.functionsPct).toBe(100);
            expect(parsed.files["src/utils/math.js"]).toBeDefined();
        });

        it("should return accurate line execution status (HIT, UNHIT, PARTIAL, IGNORED)", () => {
            const fileCov = {
                lineStatus: {
                    2: "HIT",
                    3: "PARTIAL",
                    6: "UNHIT",
                },
            };

            expect(getLineExecutionStatus(fileCov, 2)).toBe("HIT");
            expect(getLineExecutionStatus(fileCov, 3)).toBe("PARTIAL");
            expect(getLineExecutionStatus(fileCov, 6)).toBe("UNHIT");
            expect(getLineExecutionStatus(fileCov, 99)).toBe("IGNORED");
            expect(getLineExecutionStatus(null, 1)).toBe("IGNORED");
        });

        it("should format coverage for Monaco gutter decorations", () => {
            const fileCov = {
                lineHits: { 1: 1, 2: 0, 3: 2 },
                lineStatus: { 1: "HIT", 2: "UNHIT", 3: "PARTIAL" },
            };

            const gutter = formatCoverageForGutter(fileCov);
            expect(gutter).toEqual([
                { line: 1, status: "HIT", hits: 1, className: "cov-hit-line" },
                { line: 2, status: "UNHIT", hits: 0, className: "cov-unhit-line" },
                { line: 3, status: "PARTIAL", hits: 2, className: "cov-partial-line" },
            ]);
        });
    });

    describe("Task CE-3: Cross-Domain Traceability (Unit & System Testing)", () => {
        it("should trace unit coverage to tested vs untested functions", () => {
            const fileCoverageMap = {
                "src/services/auth.js": {
                    filePath: "src/services/auth.js",
                    functions: [
                        { name: "login", startLine: 10, endLine: 25, isCovered: true, hit: 3 },
                        { name: "logout", startLine: 28, endLine: 35, isCovered: false, hit: 0 },
                    ],
                },
            };

            const trace = traceUnitCoverage(fileCoverageMap);
            expect(trace).toHaveLength(2);
            expect(trace[0]).toMatchObject({ functionName: "login", isTested: true, hitCount: 3 });
            expect(trace[1]).toMatchObject({ functionName: "logout", isTested: false, hitCount: 0 });
        });

        it("should trace system E2E coverage to frontend routes and components", () => {
            const fileCoverageMap = {
                "client/src/pages/Login.jsx": {
                    filePath: "client/src/pages/Login.jsx",
                    metrics: { linesPct: 92.5 },
                },
                "client/src/pages/Checkout.jsx": {
                    filePath: "client/src/pages/Checkout.jsx",
                    metrics: { linesPct: 0 },
                },
            };

            const routesContext = [
                { route: "/login", componentFile: "client/src/pages/Login.jsx" },
                { route: "/checkout", componentFile: "client/src/pages/Checkout.jsx" },
                { route: "/about", componentFile: "client/src/pages/About.jsx" },
            ];

            const trace = traceSystemCoverage(fileCoverageMap, routesContext);
            expect(trace).toEqual([
                { route: "/login", componentFile: "client/src/pages/Login.jsx", status: "COVERED", coveragePct: 92.5 },
                { route: "/checkout", componentFile: "client/src/pages/Checkout.jsx", status: "UNCOVERED", coveragePct: 0 },
                { route: "/about", componentFile: "client/src/pages/About.jsx", status: "UNCOVERED", coveragePct: 0 },
            ]);
        });
    });

    describe("Task CE-2: Reverse API Mapping & Diagnostics (apiCoverageTracer)", () => {
        const endpoints = [
            {
                method: "POST",
                path: "/api/orders",
                controllerFile: "src/controllers/order.controller.js",
                controllerLineStart: 2,
                controllerLineEnd: 7,
            },
            {
                method: "GET",
                path: "/api/products",
                controllerFile: "src/controllers/product.controller.js",
                controllerLineStart: 10,
                controllerLineEnd: 20,
            },
            {
                method: "DELETE",
                path: "/api/users/:id",
                controllerFile: "src/controllers/user.controller.js",
                controllerLineStart: 30,
                controllerLineEnd: 40,
            },
        ];

        const fileCoverageMap = {
            "src/controllers/order.controller.js": {
                filePath: "src/controllers/order.controller.js",
                lineHits: { 2: 1, 3: 1, 4: 1, 6: 0, 7: 0 },
                uncoveredBranches: [{ line: 3, type: "if", missingPaths: [1], totalPaths: 2 }],
            },
            "src/controllers/product.controller.js": {
                filePath: "src/controllers/product.controller.js",
                lineHits: { 10: 2, 11: 2, 12: 2, 15: 2, 20: 2 },
                uncoveredBranches: [],
            },
        };

        it("should map API endpoints to COVERED, PARTIAL, and UNCOVERED statuses", () => {
            const result = traceApiEndpointCoverage({ endpoints, fileCoverageMap });

            expect(result.summary).toMatchObject({
                totalEndpoints: 3,
                coveredEndpoints: 1,
                partialEndpoints: 1,
                uncoveredEndpoints: 1,
            });

            const orderTrace = result.endpointsTraceability.find((e) => e.path === "/api/orders");
            expect(orderTrace.status).toBe("PARTIAL");
            expect(orderTrace.coveragePct).toBe(60);
            expect(orderTrace.uncoveredLines).toEqual([6, 7]);
            expect(orderTrace.missingBranches).toHaveLength(1);

            const productTrace = result.endpointsTraceability.find((e) => e.path === "/api/products");
            expect(productTrace.status).toBe("COVERED");
            expect(productTrace.coveragePct).toBe(100);

            const userTrace = result.endpointsTraceability.find((e) => e.path === "/api/users/:id");
            expect(userTrace.status).toBe("UNCOVERED");
            expect(userTrace.coveragePct).toBe(0);
        });

        it("should find the last executed line inside a controller", () => {
            const fileCov = fileCoverageMap["src/controllers/order.controller.js"];
            const sourceCode = [
                {
                    path: "src/controllers/order.controller.js",
                    content: "export const createOrder = async (req, res) => {\n  const { items } = req.body;\n  if (!items) return res.status(400);\n  const order = await db.orders.create();\n};",
                },
            ];

            const lastHit = findLastExecutedLine(fileCov, 2, 7, sourceCode);
            expect(lastHit).not.toBeNull();
            expect(lastHit.line).toBe(4);
            expect(lastHit.hits).toBe(1);
        });

        it("should diagnose ROUTER_NOT_FOUND when route returns 404 or fails to mount", () => {
            const diag = diagnoseApiFailureLayer({
                endpoint: { method: "GET", path: "/api/unknown", routeFile: "routes/api.js" },
                scenario: { actualStatus: 404, expectedStatus: 200, errorMessage: "Cannot GET /api/unknown" },
            });

            expect(diag.failureLayer).toBe("ROUTER_NOT_FOUND");
            expect(diag.diagnosticsDetails.controllerEntered).toBe(false);
        });

        it("should diagnose MIDDLEWARE_REJECTED when auth/validation fails", () => {
            const diag = diagnoseApiFailureLayer({
                endpoint: {
                    method: "POST",
                    path: "/api/orders",
                    middlewares: [{ name: "authGuard" }],
                    controllerFile: "src/controllers/order.controller.js",
                    controllerLineStart: 2,
                    controllerLineEnd: 10,
                },
                scenario: { actualStatus: 401, expectedStatus: 201, errorMessage: "Unauthorized: Invalid JWT Token" },
                fileCoverageMap: {
                    "src/controllers/order.controller.js": { lineHits: { 2: 0, 3: 0 } },
                },
            });

            expect(diag.failureLayer).toBe("MIDDLEWARE_REJECTED");
            expect(diag.failingComponent).toBe("authGuard");
            expect(diag.diagnosticsDetails.controllerEntered).toBe(false);
        });

        it("should diagnose DATABASE_FAILURE on database query error", () => {
            const diag = diagnoseApiFailureLayer({
                endpoint: { method: "POST", path: "/api/orders", controllerFile: "src/controllers/order.controller.js" },
                scenario: {
                    actualStatus: 500,
                    expectedStatus: 201,
                    errorMessage: "PrismaClientKnownRequestError: Unique constraint failed on the fields: (`email`)",
                },
            });

            expect(diag.failureLayer).toBe("DATABASE_FAILURE");
            expect(diag.suggestedFix).toContain("database");
        });

        it("should diagnose CONTROLLER_CRASH when controller throws unhandled error", () => {
            const diag = diagnoseApiFailureLayer({
                endpoint: {
                    method: "POST",
                    path: "/api/orders",
                    controllerFile: "src/controllers/order.controller.js",
                    controllerLineStart: 2,
                    controllerLineEnd: 10,
                },
                scenario: {
                    actualStatus: 500,
                    expectedStatus: 200,
                    errorMessage: "TypeError: Cannot read properties of undefined (reading 'split')",
                },
                fileCoverageMap: {
                    "src/controllers/order.controller.js": { lineHits: { 2: 1, 3: 1, 4: 0 } },
                },
            });

            expect(diag.failureLayer).toBe("CONTROLLER_CRASH");
            expect(diag.diagnosticsDetails.controllerEntered).toBe(true);
        });

        it("should diagnose ASSERTION_FAILED when response contract does not match expectations", () => {
            const diag = diagnoseApiFailureLayer({
                endpoint: {
                    method: "GET",
                    path: "/api/products",
                    controllerFile: "src/controllers/product.controller.js",
                    controllerLineStart: 10,
                    controllerLineEnd: 20,
                },
                scenario: {
                    actualStatus: 200,
                    expectedStatus: 201,
                    errorMessage: "expected 201, received 200",
                },
                fileCoverageMap: {
                    "src/controllers/product.controller.js": { lineHits: { 10: 1, 15: 1, 20: 1 } },
                },
            });

            expect(diag.failureLayer).toBe("ASSERTION_FAILED");
        });

        it("should build a comprehensive integration coverage report", () => {
            const scenarios = [
                {
                    endpoint: "/api/orders",
                    status: "FAILED",
                    actualStatus: 500,
                    expectedStatus: 201,
                    errorMessage: "PrismaClientInitializationError: Can't reach database server",
                },
            ];

            const report = buildApiCoverageReport({
                endpoints,
                coverageData: { files: fileCoverageMap },
                scenarios,
            });

            expect(report.summary.totalEndpoints).toBe(3);
            expect(report.summary.failedScenarios).toBe(1);
            expect(report.failedScenariosDiagnostics).toHaveLength(1);
            expect(report.failedScenariosDiagnostics[0].failureLayer).toBe("DATABASE_FAILURE");
            expect(report.uncoveredEndpoints.length).toBeGreaterThanOrEqual(1);
        });
    });
});
