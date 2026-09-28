import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import prisma from '../config/prisma.js';
const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

function parseCode(code) {
    return parse(code, { 
        sourceType: 'module', 
        plugins: ['jsx', 'typescript'] 
    });
}

function findScenarioPath(ast, scenarioName) {
    let foundPath = null;
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
                foundPath = path;
            }
        }
    });
    return foundPath;
}

import crypto from 'crypto';

function getScenarioName(aiTest, scenarioId) {
    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    
    // 1. Try finding by explicit scenarioId
    const req = (meta.requests || []).find(r => r.scenarioId === scenarioId);
    if (req) return req.testName;

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
        return foundName;
    } catch(e) {
        return scenarioId;
    }
}

export const getScenarioService = async (aiTestId, scenarioId) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");
    
    const scenarioName = getScenarioName(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, scenarioName);
    
    if (!path) throw new Error(`Scenario '${scenarioName}' not found in AST`);
    
    const { code } = generate(path.node);
    return { code, aiTest };
};

export const updateScenarioService = async (aiTestId, scenarioId, updatedCode) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");

    const scenarioName = getScenarioName(aiTest, scenarioId);

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
    const path = findScenarioPath(originalAst, scenarioName);
    if (!path) throw new Error(`Scenario '${scenarioName}' not found in AST`);

    // Extract the potentially new test name
    const newTestName = updatedNode.arguments[0]?.value || scenarioName;

    // Replace the node
    path.replaceWith(updatedNode);

    // Generate final code safely
    const { code: finalCode } = generate(originalAst);

    // Update Prisma
    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    const updatedRequests = requests.map(r => {
        if (r.scenarioId === scenarioId || r.testName === scenarioName) {
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

    const scenarioName = getScenarioName(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, scenarioName);
    
    if (!path) throw new Error(`Scenario '${scenarioName}' not found in AST`);
    
    path.remove();
    const { code: finalCode } = generate(ast);

    let meta = {};
    if (aiTest.metaJson) {
        try { meta = JSON.parse(aiTest.metaJson); } catch(e) {}
    }
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    meta.requests = requests.filter(r => r.scenarioId !== scenarioId && r.testName !== scenarioName);

    const updatedTest = await prisma.aiTest.update({
        where: { id: aiTestId },
        data: { 
            content: finalCode,
            metaJson: JSON.stringify(meta)
        }
    });

    return updatedTest;
};

export const toggleScenarioService = async (aiTestId, scenarioId, enable) => {
    const aiTest = await prisma.aiTest.findUnique({ where: { id: aiTestId } });
    if (!aiTest) throw new Error("AiTest not found");

    const scenarioName = getScenarioName(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, scenarioName);
    
    if (!path) throw new Error(`Scenario '${scenarioName}' not found in AST`);

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
    const requests = Array.isArray(meta.requests) ? meta.requests : [];
    meta.requests = requests.map(r => {
        if (r.scenarioId === scenarioId || r.testName === scenarioName) {
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

    const scenarioName = getScenarioName(aiTest, scenarioId);
    const ast = parseCode(aiTest.content);
    const path = findScenarioPath(ast, scenarioName);
    
    if (!path) throw new Error(`Scenario '${scenarioName}' not found in AST`);

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

    const generatedText = await generateText(prompt, "gemini-1.5-pro");
    if (!generatedText) throw new Error("Failed to generate test from AI");

    const cleanText = generatedText.replace(/```(javascript|js|typescript|ts)?/g, '').replace(/```/g, '').trim();
    
    return await updateScenarioService(aiTestId, scenarioId, cleanText);
};
