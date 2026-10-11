import esprima from "esprima";

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

    const extractPathFromNode = (node) => {
        if (!node) return null;
        if (node.type === "Literal") {
            return String(node.value);
        }
        if (node.type === "TemplateLiteral") {
            // For template literals like `/api/users/${id}`, we replace the expressions with dynamic segments
            let extractedPath = "";
            const quasis = node.quasis;
            for (let i = 0; i < quasis.length; i++) {
                extractedPath += quasis[i].value.raw;
                if (i < quasis.length - 1) {
                    // There's an expression here. Replace it with a placeholder that we can normalize later.
                    // For example: /api/users/${userId} -> /api/users/:placeholder
                    extractedPath += ":param";
                }
            }
            return extractedPath;
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
        // match: request(app).get
        if (callee.type === "MemberExpression") {
            const obj = callee.object;
            const prop = callee.property;
            
            if (obj.type === "CallExpression" && obj.callee.name === "request" && prop.type === "Identifier") {
                return prop.name.toLowerCase();
            }
        }
        return null;
    };

    const walk = (node) => {
        if (!node) return;

        // Track describe() and it()/test()
        if (node.type === "CallExpression" && node.callee.type === "Identifier") {
            if (node.callee.name === "describe" && node.arguments.length > 0) {
                const oldSuite = currentSuite;
                currentSuite = extractPathFromNode(node.arguments[0]) || currentSuite;
                
                if (node.arguments[1] && (node.arguments[1].type === "ArrowFunctionExpression" || node.arguments[1].type === "FunctionExpression")) {
                    walk(node.arguments[1].body);
                }
                currentSuite = oldSuite;
                return;
            }

            if ((node.callee.name === "it" || node.callee.name === "test") && node.arguments.length > 0) {
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
                                        testExpectedStatus = argVal.value;
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

                    // Now scan for request calls inside this test
                    const scanRequests = (rNode) => {
                        if (!rNode) return;
                        if (rNode.type === "CallExpression") {
                            const method = isRequestCall(rNode.callee);
                            if (method && ['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
                                let reqPath = "mappingUnavailable";
                                if (rNode.arguments.length > 0) {
                                    reqPath = extractPathFromNode(rNode.arguments[0]) || "mappingUnavailable";
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

                                results.push({
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
