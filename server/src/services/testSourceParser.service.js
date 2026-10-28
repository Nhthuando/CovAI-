import * as esprimaModule from "esprima";
const esprima = esprimaModule?.default?.parseScript ? esprimaModule.default : esprimaModule;


/**
 * Extracts Supertest requests from an AI-generated Jest test file content.
 * 
 * @param {string} sourceCode 
 * @param {string} filePath 
 * @returns {Array<{testName: string, suiteName: string, method: string, path: string, testFile: string}>}
 */
export const extractTestRequests = (sourceCode, filePath) => {
    const results = [];
    let ast;
    try {
        ast = esprima.parseModule(sourceCode, { jsx: true, tolerant: true, range: true });
    } catch (e) {
        try {
            ast = esprima.parseScript(sourceCode, { tolerant: true, range: true });
        } catch (err) {
            console.error(`[TestSourceParser] Failed to parse AST for ${filePath}`, err.message);
            return results;
        }
    }

    let currentSuite = "";
    let currentTest = "";

    const extractPathFromNode = (node, vars = {}) => {
        if (!node) return null;
        if (node.type === "Literal") {
            return String(node.value);
        }
        if (node.type === "TemplateLiteral") {
            // For template literals like `/api/users/${id}`, resolve expressions using local vars if available
            let extractedPath = "";
            const quasis = node.quasis || [];
            const exprs = node.expressions || [];
            for (let i = 0; i < quasis.length; i++) {
                extractedPath += quasis[i].value.raw;
                if (i < exprs.length) {
                    const expr = exprs[i];
                    if (expr.type === "Literal") {
                        extractedPath += String(expr.value);
                    } else if (expr.type === "Identifier" && vars[expr.name] !== undefined && vars[expr.name] !== null) {
                        extractedPath += String(vars[expr.name]);
                    } else if (expr.type === "Identifier") {
                        extractedPath += expr.name;
                    } else {
                        extractedPath += ":param";
                    }
                }
            }
            return extractedPath;
        }
        if (node.type === "Identifier") {
            if (vars[node.name] !== undefined && vars[node.name] !== null) return String(vars[node.name]);
            return node.name || ":param";
        }
        if (node.type === "BinaryExpression" && node.operator === "+") {
            const left = extractPathFromNode(node.left, vars);
            const right = extractPathFromNode(node.right, vars);
            if (left !== "mappingUnavailable" && right !== "mappingUnavailable") {
                return left + right;
            }
        }
        return "mappingUnavailable";
    };

    const extractLiteralOrObject = (node) => {
        if (!node) return null;
        if (node.type === "Literal") return node.value;
        if (node.type === "ObjectExpression") {
            const obj = {};
            for (const prop of (node.properties || [])) {
                const key = prop.key ? (prop.key.name || prop.key.value) : null;
                if (key) {
                    obj[key] = extractLiteralOrObject(prop.value);
                }
            }
            return obj;
        }
        if (node.type === "ArrayExpression") {
            return (node.elements || []).map(extractLiteralOrObject);
        }
        if (node.type === "Identifier") {
            return `<${node.name}>`;
        }
        return null;
    };

    const isRequestCall = (callee) => {
        // match: request(app).get or (0, _supertest.default)(app).get
        if (callee.type === "MemberExpression") {
            const obj = callee.object;
            const prop = callee.property;
            
            if (obj.type === "CallExpression" && prop.type === "Identifier") {
                const c = obj.callee;
                const isDirectRequest = c.name === "request";
                const isBabelSupertest = (c.type === "SequenceExpression" && c.expressions?.some(e => (e.property?.name === "default" || e.name?.includes("supertest")))) ||
                                         (c.type === "MemberExpression" && c.property?.name === "default" && c.object?.name?.includes("supertest"));
                if (isDirectRequest || isBabelSupertest) {
                    return prop.name.toLowerCase();
                }
            }
        }
        return null;
    };

    const walk = (node) => {
        if (!node) return;

        const isDescribe = (callee) => {
            if (!callee) return false;
            if (callee.type === "Identifier" && callee.name === "describe") return true;
            if (callee.type === "MemberExpression" && callee.object?.name === "describe") return true;
            return false;
        };

        const isTestOrIt = (callee) => {
            if (!callee) return false;
            if (callee.type === "Identifier" && (callee.name === "it" || callee.name === "test")) return true;
            if (callee.type === "MemberExpression" && (callee.object?.name === "it" || callee.object?.name === "test")) return true;
            return false;
        };

        // Track describe() and it()/test() (including .skip, .only)
        if (node.type === "CallExpression") {
            if (isDescribe(node.callee) && node.arguments.length > 0) {
                const oldSuite = currentSuite;
                currentSuite = extractPathFromNode(node.arguments[0]) || currentSuite;
                
                if (node.arguments[1] && (node.arguments[1].type === "ArrowFunctionExpression" || node.arguments[1].type === "FunctionExpression")) {
                    walk(node.arguments[1].body);
                }
                currentSuite = oldSuite;
                return;
            }

            if (isTestOrIt(node.callee) && node.arguments.length > 0) {
                const oldTest = currentTest;
                currentTest = extractPathFromNode(node.arguments[0]) || currentTest;
                
                const fn = node.arguments[1];
                if (fn && (fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression") && fn.body) {
                    // Pre-scan test body for local variables, send payload, and expectedStatus
                    const testVars = {};
                    let testPayload = null;
                    let testQueryParams = null;
                    let testExpectedStatus = null;

                    const scanTestBody = (bNode) => {
                        if (!bNode) return;
                        if (bNode.type === "VariableDeclaration") {
                            for (const decl of (bNode.declarations || [])) {
                                if (decl.id?.name && decl.init) {
                                    testVars[decl.id.name] = extractLiteralOrObject(decl.init);
                                }
                            }
                        }
                        if (bNode.type === "CallExpression") {
                            const propName = bNode.callee?.property?.name;
                            if (propName === "send" && bNode.arguments?.[0]) {
                                const arg = bNode.arguments[0];
                                if (arg.type === "Identifier" && testVars[arg.name] !== undefined) {
                                    testPayload = testVars[arg.name];
                                } else {
                                    testPayload = extractLiteralOrObject(arg);
                                }
                            }
                            if (propName === "query" && bNode.arguments?.[0]) {
                                const arg = bNode.arguments[0];
                                if (arg.type === "Identifier" && testVars[arg.name] !== undefined) {
                                    testQueryParams = testVars[arg.name];
                                } else {
                                    testQueryParams = extractLiteralOrObject(arg);
                                }
                            }
                            if ((propName === "toBe" || propName === "toEqual") && bNode.arguments?.[0]) {
                                const argVal = bNode.arguments[0];
                                const targetObj = bNode.callee?.object;
                                const targetArg = targetObj?.arguments?.[0];
                                if (targetArg?.property?.name === "status" || targetArg?.property?.name === "statusCode") {
                                    if (argVal.type === "Literal") {
                                        const objName = targetArg?.object?.name || "";
                                        const isSetupOrTeardown = /^(created|create|seed|setup|init|verify|teardown|cleanup|after)/i.test(objName);
                                        if ((!testExpectedStatus && !isSetupOrTeardown) || (!isSetupOrTeardown && (objName === "res" || objName === "response" || /res$/i.test(objName)))) {
                                            testExpectedStatus = argVal.value;
                                        } else if (!testExpectedStatus) {
                                            testExpectedStatus = argVal.value;
                                        }
                                    }
                                }
                            }
                        }
                        for (const k in bNode) {
                            if (bNode[k] && typeof bNode[k] === "object") {
                                if (Array.isArray(bNode[k])) {
                                    bNode[k].forEach(scanTestBody);
                                } else {
                                    scanTestBody(bNode[k]);
                                }
                            }
                        }
                    };

                    scanTestBody(fn.body);

                    const testRequests = [];
                    // Now scan for request calls inside this test
                    const scanRequests = (rNode) => {
                        if (!rNode) return;
                        if (rNode.type === "CallExpression") {
                            const method = isRequestCall(rNode.callee);
                            if (method && ['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
                                let reqPath = "mappingUnavailable";
                                if (rNode.arguments.length > 0) {
                                    reqPath = extractPathFromNode(rNode.arguments[0], testVars) || "mappingUnavailable";
                                }

                                // Parse query string from path if present
                                let qParams = testQueryParams;
                                if (!qParams && reqPath.includes("?")) {
                                    try {
                                        const queryStr = reqPath.split("?")[1];
                                        const parsedQ = {};
                                        new URLSearchParams(queryStr).forEach((val, key) => {
                                            parsedQ[key] = val;
                                        });
                                        qParams = parsedQ;
                                    } catch (_) {}
                                }

                                testRequests.push({
                                    suiteName: currentSuite,
                                    testName: currentTest,
                                    method: method.toUpperCase(),
                                    path: reqPath,
                                    testFile: filePath,
                                    payload: testPayload,
                                    queryParams: qParams,
                                    expectedStatus: testExpectedStatus
                                });
                            }
                        }
                        for (const k in rNode) {
                            if (rNode[k] && typeof rNode[k] === "object") {
                                if (Array.isArray(rNode[k])) {
                                    rNode[k].forEach(scanRequests);
                                } else {
                                    scanRequests(rNode[k]);
                                }
                            }
                        }
                    };

                    scanRequests(fn.body);

                    if (testRequests.length === 1) {
                        results.push(testRequests[0]);
                    } else if (testRequests.length > 1) {
                        // When a test contains multiple requests (e.g. setup POST then target PUT/DELETE),
                        // choose the single primary target request for this test.
                        let targetRequest = null;
                        const suiteUpper = (currentSuite || "").toUpperCase();
                        const testUpper = (currentTest || "").toUpperCase();

                        // 1. Prioritize request whose method AND path match currentSuite
                        for (const req of testRequests) {
                            const methodMatch = suiteUpper.includes(req.method);
                            const cleanReq = (req.path || "").split("?")[0].replace(/\/+$/, "") || "/";
                            const reqBase = cleanReq.includes("/") ? cleanReq.split("/").slice(-1)[0] : cleanReq;
                            const pathMatch = suiteUpper.includes(cleanReq) || (reqBase && suiteUpper.includes(reqBase));
                            if (methodMatch && pathMatch) {
                                targetRequest = req;
                                break;
                            }
                        }

                        // 2. Prioritize request whose method matches currentSuite
                        if (!targetRequest) {
                            for (const req of testRequests) {
                                if (suiteUpper.includes(req.method)) {
                                    targetRequest = req;
                                    break;
                                }
                            }
                        }

                        // 2b. Prioritize request whose method AND path match test name
                        if (!targetRequest) {
                            for (const req of testRequests) {
                                const methodMatch = testUpper.includes(req.method);
                                const cleanReq = (req.path || "").split("?")[0].replace(/\/+$/, "") || "/";
                                const reqBase = cleanReq.includes("/") ? cleanReq.split("/").slice(-1)[0] : cleanReq;
                                const pathMatch = testUpper.includes(cleanReq) || (reqBase && testUpper.includes(reqBase));
                                if (methodMatch && pathMatch) {
                                    targetRequest = req;
                                    break;
                                }
                            }
                        }

                        // 3. Prioritize request whose method matches test name
                        if (!targetRequest) {
                            for (const req of testRequests) {
                                if (testUpper.includes(req.method)) {
                                    targetRequest = req;
                                    break;
                                }
                            }
                        }

                        // 4. Default: Pick the LAST request in the test body (the "Act" call in Arrange-Act-Assert)
                        if (!targetRequest) {
                            targetRequest = testRequests[testRequests.length - 1];
                        }

                        results.push(targetRequest);
                    }
                }
                currentTest = oldTest;
                return;
            }
        }

        // Walk children
        for (const key in node) {
            if (node[key] && typeof node[key] === "object") {
                if (Array.isArray(node[key])) {
                    node[key].forEach(child => walk(child));
                } else {
                    walk(node[key]);
                }
            }
        }
    };

    walk(ast);
    return results;
};
