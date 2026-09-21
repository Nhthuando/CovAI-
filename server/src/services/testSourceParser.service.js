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
                
                if (node.arguments[1] && (node.arguments[1].type === "ArrowFunctionExpression" || node.arguments[1].type === "FunctionExpression")) {
                    walk(node.arguments[1].body);
                }
                currentTest = oldTest;
                return;
            }
        }

        // Look for request(app).get(...)
        if (node.type === "CallExpression") {
            const method = isRequestCall(node.callee);
            if (method && ['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
                let reqPath = "mappingUnavailable";
                if (node.arguments.length > 0) {
                    reqPath = extractPathFromNode(node.arguments[0]) || "mappingUnavailable";
                }

                if (currentTest) {
                    results.push({
                        suiteName: currentSuite,
                        testName: currentTest,
                        method: method.toUpperCase(),
                        path: reqPath,
                        testFile: filePath
                    });
                }
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
