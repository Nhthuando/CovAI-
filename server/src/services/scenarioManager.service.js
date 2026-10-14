import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import prisma from '../config/prisma.js';
import crypto from 'crypto';
const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

export function parseCode(code) {
    return parse(code, { 
        sourceType: 'module', 
        plugins: ['jsx', 'typescript'] 
    });
}

export function findScenarioPath(ast, scenarioName, targetIndex = 0) {
    let foundPath = null;
    let currentIndex = 0;
    traverse(ast, {
        CallExpression(path) {
            if (foundPath) return;
            const { callee, arguments: args } = path.node;
            
            let isTest = false;
            if (callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test')) {
                isTest = true;
            } else if (callee.type === 'MemberExpression' && (callee.object.name === 'it' || callee.object.name === 'test')) {
                isTest = true;
            }
            
            if (isTest && args.length > 0 && args[0].type === 'StringLiteral' && args[0].value === scenarioName) {
                if (currentIndex === targetIndex) {
                    foundPath = path;
                } else {
                    currentIndex++;
                }
            }
        }
    });
    return foundPath;
}


export function getScenarioIdentity(aiTest, scenarioId) {
    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    
    // 1. Try finding by explicit scenarioId
    const reqs = meta.requests || [];
    let nameIndex = 0;
    const req = reqs.find((r, idx) => {
        if (r.scenarioId === scenarioId) {
            for (let i = 0; i < idx; i++) {
                if (reqs[i].testName === r.testName) nameIndex++;
            }
            return true;
        }
        return false;
    });
    
    if (req) {
        return { testName: req.testName, nameIndex };
    }

    // 2. Fallback for legacy records (MD5 hash of testName)
    try {
        const ast = parseCode(aiTest.content);
        let foundName = scenarioId;
        traverse(ast, {
            CallExpression(path) {
                const { callee, arguments: args } = path.node;
                let isTest = false;
                if (callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test')) {
                    isTest = true;
                } else if (callee.type === 'MemberExpression' && (callee.object.name === 'it' || callee.object.name === 'test')) {
                    isTest = true;
                }
                
                if (isTest && args.length > 0 && args[0].type === 'StringLiteral') {
                    const testName = args[0].value;
                    const hash = crypto.createHash('md5').update(testName).digest('hex').substring(0, 8);
                    if (hash === scenarioId || testName === scenarioId) {
                        foundName = testName;
                    }
                }
            }
        });
        return { testName: foundName, nameIndex: 0 };
    } catch(e) {
        return { testName: scenarioId, nameIndex: 0 };
    }
}

export const getScenarioService = async (aiTestId, scenarioId) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");
    
    const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, testName, nameIndex);
    
    if (!path) throw new Error(`Scenario '${testName}' (index ${nameIndex}) not found in AST`);
    
    const { code } = generate(path.node);
    return { code, aiTest };
};

export const updateScenarioService = async (aiTestId, scenarioId, updatedCode) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");

    const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);

    // Ensure the updated code is valid JS/TS
    const updatedAst = parseCode(updatedCode);
    
    // Check if it actually contains a test
    let updatedNode = null;
    traverse(updatedAst, {
        CallExpression(path) {
            if (!updatedNode) updatedNode = path.node; // Take the first CallExpression (e.g. it(...))
        }
    });
    if (!updatedNode) throw new Error("Updated code does not contain a valid test statement");

    const originalAst = parseCode(aiTest.content);
    const path = findScenarioPath(originalAst, testName, nameIndex);
    if (!path) throw new Error(`Scenario '${testName}' (index ${nameIndex}) not found in AST`);

    // Extract the potentially new test name
    const newTestName = updatedNode.arguments[0]?.value || testName;

    // Replace the node
    path.replaceWith(updatedNode);

    // Generate final code safely
    const { code: finalCode } = generate(originalAst);

    // Update Prisma
    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    meta.userModified = true; // Mark artifact as dirty
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    const updatedRequests = requests.map(r => {
        if (r.scenarioId === scenarioId || (r.testName === testName && nameIndex === 0 && !r.scenarioId)) {
            return { ...r, testName: newTestName, scenarioId, userEdited: true, lastModifiedAt: new Date().toISOString() };
        }
        return r;
    });
    if (!updatedRequests.find(r => r.scenarioId === scenarioId || r.testName === newTestName)) {
        updatedRequests.push({ scenarioId, testName: newTestName, userEdited: true, lastModifiedAt: new Date().toISOString() });
    }
    meta.requests = updatedRequests;

    const updatedTest = await prisma.aiTest.update({
        where: { id: aiTestId },
        data: { 
            content: finalCode,
            metaJson: JSON.stringify(meta)
        }
    });

    return updatedTest;
};

export const deleteScenarioService = async (aiTestId, scenarioId) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");

    const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, testName, nameIndex);
    
    if (!path) throw new Error(`Scenario '${testName}' (index ${nameIndex}) not found in AST`);
    
    path.remove();
    const { code: finalCode } = generate(ast);

    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    meta.userModified = true; // Mark artifact as dirty
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    meta.requests = requests.filter(r => r.scenarioId !== scenarioId && !(r.testName === testName && nameIndex === 0 && !r.scenarioId));

    const updatedTest = await prisma.aiTest.update({
        where: { id: aiTestId },
        data: { 
            content: finalCode,
            metaJson: JSON.stringify(meta)
        }
    });

    return updatedTest;
};

export const stripAiScenariosService = (aiTest) => {
    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    
    // If no manual scenarios, return null to indicate file should be deleted
    const hasManual = requests.some(r => r.userEdited);
    if (!hasManual) return null;

    const ast = parseCode(aiTest.content);
    const aiRequests = requests.filter(r => !r.userEdited);
    const manualRequests = requests.filter(r => r.userEdited);

    for (const r of aiRequests) {
        let nameIndex = 0;
        // Count how many times this testName appeared before in the ORIGINAL requests list to find the correct index
        for (const origReq of requests) {
            if (origReq === r) break;
            if (origReq.testName === r.testName) nameIndex++;
        }
        
        const path = findScenarioPath(ast, r.testName, nameIndex);
        if (path) {
            path.remove();
        }
    }

    meta.requests = manualRequests;
    const { code: finalCode } = generate(ast);

    return {
        id: aiTest.id,
        filePath: aiTest.filePath,
        content: finalCode,
        metaJson: JSON.stringify(meta)
    };
};

export const toggleScenarioService = async (aiTestId, scenarioId, enable) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");

    const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, testName, nameIndex);
    
    if (!path) throw new Error(`Scenario '${testName}' (index ${nameIndex}) not found in AST`);

    const callee = path.node.callee;
    if (enable) {
        // Change it.skip to it
        if (callee.type === 'MemberExpression' && (callee.object.name === 'it' || callee.object.name === 'test')) {
            path.node.callee = callee.object;
        }
    } else {
        // Change it to it.skip
        if (callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test')) {
            path.node.callee = {
                type: 'MemberExpression',
                object: callee,
                property: { type: 'Identifier', name: 'skip' },
                computed: false
            };
        }
    }

    const { code: finalCode } = generate(ast);

    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    meta.userModified = true; // Mark artifact as dirty
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    meta.requests = requests.map(r => {
        if (r.scenarioId === scenarioId || (r.testName === testName && nameIndex === 0 && !r.scenarioId)) {
            return { ...r, enabled: enable, scenarioId, lastModifiedAt: new Date().toISOString() };
        }
        return r;
    });

    const updatedTest = await prisma.aiTest.update({
        where: { id: aiTestId },
        data: { 
            content: finalCode,
            metaJson: JSON.stringify(meta)
        }
    });

    return updatedTest;
};

export const addScenarioService = async (aiTestId, newScenarioCode, endpoint) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");

    const newAst = parseCode(newScenarioCode);
    let newScenarioNode = null;
    traverse(newAst, {
        CallExpression(path) {
            if (!newScenarioNode) newScenarioNode = path.node;
        }
    });
    if (!newScenarioNode) throw new Error("New code does not contain a valid test statement");

    const testName = newScenarioNode.arguments[0]?.value;
    if (!testName) throw new Error("Could not extract test name from new scenario");

    const ast = parseCode(aiTest.content);
    let describePath = null;
    traverse(ast, {
        CallExpression(path) {
            if (!describePath && path.node.callee.name === 'describe') {
                describePath = path;
            }
        }
    });

    if (!describePath) throw new Error("No describe block found in target test file");
    
    // Add to describe block
    const bodyNode = describePath.node.arguments[1];
    if (bodyNode && bodyNode.body && bodyNode.body.body) {
        bodyNode.body.body.push({ type: 'ExpressionStatement', expression: newScenarioNode });
    }

    const { code: finalCode } = generate(ast);

    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    meta.userModified = true; // Mark artifact as dirty
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    const newScenarioId = crypto.randomUUID();
    requests.push({
        scenarioId: newScenarioId,
        method: endpoint.method,
        path: endpoint.path,
        testName: testName,
        enabled: true,
        userEdited: true,
        lastModifiedAt: new Date().toISOString()
    });
    meta.requests = requests;

    const updatedTest = await prisma.aiTest.update({
        where: { id: aiTestId },
        data: { 
            content: finalCode,
            metaJson: JSON.stringify(meta)
        }
    });

    return updatedTest;
};

import { generateText } from "./gemini.service.js";

export const regenerateScenarioService = async (aiTestId, scenarioId, payload = {}) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");

    const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, testName, nameIndex);
    
    if (!path) throw new Error(`Scenario '${testName}' (index ${nameIndex}) not found in AST`);

    const { code: originalCode } = generate(path.node);
    
    // Inject API context if available
    let apiContext = "";
    if (payload.apiDefinitions && payload.apiDefinitions.length > 0) {
        apiContext = `Available API Endpoints:\n${JSON.stringify(payload.apiDefinitions, null, 2)}\n\n`;
    }

    const prompt = `You are an expert testing engineer. The user wants to regenerate a specific Integration Test scenario.
Keep the same test framework and style. Return ONLY the new test code block, without markdown formatting if possible.

${apiContext}
Original scenario code:
${originalCode}

Please improve it, fix potential issues, or make it more robust based on the API context if relevant. Do NOT output a full file, ONLY the test block (e.g. it(...) {...}).
`;

    const generatedText = await generateText(prompt, "gemini-3.8-flash");
    if (!generatedText) throw new Error("Failed to generate test from AI");

    const cleanText = generatedText.replace(/```(javascript|js|typescript|ts)?/g, '').replace(/```/g, '').trim();
    
    return await updateScenarioService(aiTestId, scenarioId, cleanText);
};

/**
 * Prunes specific scenarios from raw test file code using AST.
 * Ensures that if the LLM generated test cases for unselected/rejected endpoints,
 * their code blocks (it/test) are cleanly stripped from the content string before saving.
 *
 * @param {string} content - Raw JavaScript test file content
 * @param {Array<object>} allRequests - All requests initially parsed from the content
 * @param {Array<object>} rejectedRequests - Requests that failed batch/endpoint validation
 * @returns {string} Cleaned JavaScript code
 */
export const pruneScenariosFromCode = (content, allRequests = [], rejectedRequests = []) => {
    if (!content || !rejectedRequests || rejectedRequests.length === 0) {
        return content;
    }

    try {
        const ast = parseCode(content);
        const rejectedSet = new Set(rejectedRequests);
        const pathsToRemove = new Set();

        // 1. Collect all test CallExpressions in AST in document order
        const testCalls = [];
        traverse(ast, {
            CallExpression(path) {
                const { callee, arguments: args } = path.node;
                let isTest = false;
                if (callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test')) {
                    isTest = true;
                } else if (callee.type === 'MemberExpression' && (callee.object.name === 'it' || callee.object.name === 'test')) {
                    isTest = true;
                }

                if (isTest && args.length > 0 && args[0].type === 'StringLiteral') {
                    testCalls.push({
                        path,
                        testName: args[0].value
                    });
                }
            }
        });

        // 2. Correlate allRequests to testCalls in document order
        const handledRejected = new Set();
        let callIdx = 0;
        for (const req of allRequests) {
            while (callIdx < testCalls.length && testCalls[callIdx].testName !== req.testName) {
                callIdx++;
            }
            if (callIdx < testCalls.length) {
                if (rejectedSet.has(req)) {
                    pathsToRemove.add(testCalls[callIdx].path);
                    handledRejected.add(req);
                }
                callIdx++;
            }
        }

        // 3. Fallback: only for rejected requests not correlated in step 2
        for (const rej of rejectedRequests) {
            if (handledRejected.has(rej)) continue;
            const unmatched = testCalls.find(tc => tc.testName === rej.testName && !pathsToRemove.has(tc.path));
            if (unmatched) {
                pathsToRemove.add(unmatched.path);
                handledRejected.add(rej);
            }
        }

        // 4. Remove all identified paths (expression statement or call expression)
        for (const p of pathsToRemove) {
            if (p.parentPath && p.parentPath.isExpressionStatement()) {
                p.parentPath.remove();
            } else {
                p.remove();
            }
        }

        // 5. Clean up any newly empty describe blocks
        traverse(ast, {
            CallExpression(path) {
                const { callee, arguments: args } = path.node;
                if (callee.type === 'Identifier' && callee.name === 'describe' && args.length > 1) {
                    const callback = args[1];
                    if ((callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') && callback.body) {
                        if (callback.body.type === 'BlockStatement' && callback.body.body.length === 0) {
                            if (path.parentPath && path.parentPath.isExpressionStatement()) {
                                path.parentPath.remove();
                            } else {
                                path.remove();
                            }
                        }
                    }
                }
            }
        });

        const { code: finalCode } = generate(ast);
        return finalCode;
    } catch (err) {
        return content;
    }
};
