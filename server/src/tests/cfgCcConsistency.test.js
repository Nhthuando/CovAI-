import { describe, it, expect } from "@jest/globals";
import { parse } from "@babel/parser";
import { buildCFG } from "../services/cfgBuilder.service.js";
import { calculateComplexityFromAst } from "../services/cyclomaticCalculator.service.js";

const functionTypes = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);

const findFunctions = (node, functions = []) => {
  if (!node || typeof node !== "object") return functions;
  if (functionTypes.has(node.type)) functions.push(node);
  for (const [key, child] of Object.entries(node)) {
    if (["loc", "extra", "parent"].includes(key)) continue;
    if (Array.isArray(child)) child.forEach(item => findFunctions(item, functions));
    else if (child && typeof child === "object") findFunctions(child, functions);
  }
  return functions;
};

const corpus = [
  ["ifElse", "function ifElse(a){ if (a) { x(); } else { y(); } return; }", [2]],
  ["Express handler", "const handler = (req, res) => { const title = (req.body?.title || '').trim(); if (!title) return res.status(400).json({}); const todo = { title }; todos.push(todo); res.status(201).json(todo); };", [3]],
  ["riskCC4", "function riskCC4(a,b,c){ if(a) return 1; if(b) return 2; if(c) return 3; return 0; }", [4]],
  ["ternary", "function t(a){ return a ? 1 : 2; }", [2]],
  ["logical expressions", "function l(a,b,c){ const v = (a && b || c) ?? 0; return v; }", [4]],
  ["switch", "function sw(k){ switch(k){ case 1: return 'a'; case 2: return 'b'; default: return 'c'; } }", [3]],
  ["try/catch/finally", "function tc(){ try { a(); } catch (e) { b(); } finally { c(); } }", [2]],
  ["loops", "function loops(xs){ for (const x of xs) { if (x) continue; } while (g()) { h(); } }", [4]],
  ["nested arrow", "function outer(){ return list.map(x => x && y); }", [1, 2]],
  ["empty function", "function emptyFn() {}", [1]],
];

describe("CFG McCabe consistency (TC_CFG_09)", () => {
  for (const [name, source, expectedValues] of corpus) {
    it(name, () => {
      const ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] });
      const functions = findFunctions(ast);
      expect(functions).toHaveLength(expectedValues.length);
      functions.forEach((fn, index) => {
        const { nodes, edges } = buildCFG(fn).graphJson;
        const cc = calculateComplexityFromAst(fn).value;
        expect(cc).toBe(expectedValues[index]);
        if (name === "empty function") {
          expect(nodes).toHaveLength(0);
          return;
        }
        const outgoing = new Set(edges.map(edge => edge.from));
        const leaves = nodes.filter(node => !outgoing.has(node.id)).length;
        expect(edges.length - nodes.length + leaves + 1).toBe(cc);
        if (name === "ifElse") {
          const condition = nodes.find(node => node.type === "condition");
          const returnNode = nodes.find(node => node.type === "return");
          expect(edges.some(edge => edge.from === condition.id && edge.to === returnNode.id)).toBe(false);
        }
      });
    });
  }
});
