import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { loadSourceCode } from "./aiContextBuilder.service.js";
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { extractTestRequests } from "./testSourceParser.service.js";
import { cleanStoragePath } from "../utils/pathSanitizer.js";
import {
  classifyScenario,
  getScenarioCaseKey,
} from "../../../shared/integrationCaseCoverage.js";
import _traverse from "@babel/traverse";

const traverse = _traverse.default || _traverse;

const normalizePathKey = (p = "") =>
  String(p || "")
    .split("?")[0]
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || "/";

function doesRouteMatch(routePath = "", requestPath = "") {
  const normRoute = normalizePathKey(routePath);
  const normReq = normalizePathKey(requestPath);
  if (normRoute.toLowerCase() === normReq.toLowerCase()) return true;

  const routeParts = normRoute.split("/").filter(Boolean);
  const reqParts = normReq.split("/").filter(Boolean);
  if (routeParts.length !== reqParts.length) return false;

  for (let i = 0; i < routeParts.length; i++) {
    const rp = routeParts[i];
    const qp = reqParts[i];
    if (
      rp.startsWith(":") ||
      (rp.startsWith("{") && rp.endsWith("}")) ||
      (rp.startsWith("[") && rp.endsWith("]")) ||
      rp === "*"
    ) {
      continue;
    }
    if (rp.toLowerCase() !== qp.toLowerCase()) return false;
  }
  return true;
}

function findSourceFile(sourceFiles = [], targetPath = "") {
  if (!targetPath || !Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    return null;
  }
  const normTarget = normalizePathKey(targetPath).toLowerCase();
  return (
    sourceFiles.find((f) => {
      const p = normalizePathKey(f.path || f.filePath || "").toLowerCase();
      return p === normTarget || p.endsWith(normTarget) || normTarget.endsWith(p);
    }) || null
  );
}

function extractLineWindow(content = "", startLine = 1, maxLines = 30) {
  if (!content) return "";
  const lines = content.split("\n");
  const startIdx = Math.max(0, (Number(startLine) || 1) - 1);
  const endIdx = Math.min(lines.length, startIdx + maxLines);
  return lines.slice(startIdx, endIdx).join("\n");
}

function sliceNodeSource(code = "", node = null, maxLen = 90) {
  if (!code || !node || typeof node.start !== "number" || typeof node.end !== "number") {
    return "";
  }
  const raw = code.slice(node.start, node.end).replace(/\s+/g, " ").trim();
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

function parseSnippetWithFallback(snippet = "") {
  if (!snippet || !snippet.trim()) return { ast: null, code: "", lineOffset: 0 };
  const direct = parseJavaScriptCode(snippet);
  if (direct.success && direct.ast) {
    return { ast: direct.ast, code: snippet, lineOffset: 0 };
  }
  const wrappedObj = `const __covaiObj = {\n${snippet}\n};`;
  const asObjProp = parseJavaScriptCode(wrappedObj);
  if (asObjProp.success && asObjProp.ast) {
    return { ast: asObjProp.ast, code: wrappedObj, lineOffset: 1 };
  }
  const wrappedClass = `class __CovaiCls {\n${snippet}\n}`;
  const asClassMethod = parseJavaScriptCode(wrappedClass);
  if (asClassMethod.success && asClassMethod.ast) {
    return { ast: asClassMethod.ast, code: wrappedClass, lineOffset: 1 };
  }
  return { ast: null, code: snippet, lineOffset: 0 };
}

function findPrimaryHandlerBody(ast) {
  if (!ast) return null;
  let candidateBody = null;
  const programBody = ast.program?.body || [];

  for (const stmt of programBody) {
    // Case 1: Inline route registration: app.get('/path', ..., (req, res) => { ... })
    if (
      stmt.type === "ExpressionStatement" &&
      stmt.expression?.type === "CallExpression" &&
      stmt.expression.arguments?.length >= 2
    ) {
      const args = stmt.expression.arguments;
      for (let i = args.length - 1; i >= 0; i--) {
        const arg = args[i];
        if (
          (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") &&
          arg.body?.type === "BlockStatement"
        ) {
          return arg.body;
        }
      }
    }
    // Case 2: export async function handler(req, res) { ... } or function handler
    if (stmt.type === "FunctionDeclaration" && stmt.body?.type === "BlockStatement") {
      return stmt.body;
    }
    if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl?.type === "FunctionDeclaration" && decl.body?.type === "BlockStatement") {
        return decl.body;
      }
      if (
        (decl?.type === "ArrowFunctionExpression" || decl?.type === "FunctionExpression") &&
        decl.body?.type === "BlockStatement"
      ) {
        return decl.body;
      }
      if (decl?.type === "VariableDeclaration") {
        for (const d of decl.declarations || []) {
          if (
            (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression") &&
            d.init.body?.type === "BlockStatement"
          ) {
            return d.init.body;
          }
        }
      }
    }
    // Case 3: const handler = async (req, res) => { ... } or wrapped __covaiObj
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations || []) {
        if (
          (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression") &&
          d.init.body?.type === "BlockStatement"
        ) {
          return d.init.body;
        }
        if (d.id?.name === "__covaiObj" && d.init?.type === "ObjectExpression") {
          for (const prop of d.init.properties || []) {
            if (prop.type === "ObjectMethod" && prop.body?.type === "BlockStatement") {
              return prop.body;
            }
            if (
              prop.type === "ObjectProperty" &&
              (prop.value?.type === "ArrowFunctionExpression" ||
                prop.value?.type === "FunctionExpression") &&
              prop.value.body?.type === "BlockStatement"
            ) {
              return prop.value.body;
            }
          }
        }
      }
    }
    if (stmt.type === "ClassDeclaration") {
      for (const m of stmt.body?.body || []) {
        if (m.type === "ClassMethod" && m.body?.type === "BlockStatement") {
          return m.body;
        }
      }
    }
  }

  return candidateBody;
}

function detectDbCallInText(text = "") {
  if (!text) return null;
  const prismaMatch = text.match(/\bprisma\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\(/);
  if (prismaMatch) {
    return {
      orm: "Prisma",
      model: prismaMatch[1],
      method: prismaMatch[2],
      operation: `prisma.${prismaMatch[1]}.${prismaMatch[2]}()`,
    };
  }
  const mongooseMatch = text.match(
    /\b([A-Z][a-zA-Z0-9_]+)\.(find|findOne|findById|findByIdAndUpdate|findByIdAndDelete|findOneAndUpdate|findOneAndDelete|create|insertMany|updateOne|updateMany|deleteOne|deleteMany|countDocuments|aggregate|save)\s*\(/,
  );
  if (mongooseMatch) {
    return {
      orm: "Mongoose",
      model: mongooseMatch[1],
      method: mongooseMatch[2],
      operation: `${mongooseMatch[1]}.${mongooseMatch[2]}()`,
    };
  }
  const sqlMatch = text.match(/\b(pool|db|knex|sequelize|client)\.(query|execute|raw)\s*\(/i);
  if (sqlMatch) {
    return {
      orm: "SQL",
      model: sqlMatch[1],
      method: sqlMatch[2],
      operation: `${sqlMatch[1]}.${sqlMatch[2]}()`,
    };
  }
  return null;
}

function extractStatusAndMessage(nodeCode = "") {
  let statusCode = null;
  const statusMatch = nodeCode.match(/res\.(?:status|sendStatus)\(\s*(\d{3})\s*\)/);
  if (statusMatch) {
    statusCode = Number(statusMatch[1]);
  } else if (/\bres\.(?:json|send|end)\s*\(/.test(nodeCode)) {
    statusCode = 200;
  } else if (/\bnext\s*\(/.test(nodeCode) || /\bthrow\b/.test(nodeCode)) {
    statusCode = 500;
  }

  const msgMatch = nodeCode.match(/message\s*:\s*(?:['"`]([^'"`]{1,120})['"`]|`([^`]{1,120})`)/);
  const errorMessage = msgMatch ? (msgMatch[1] || msgMatch[2] || "").trim() : null;
  return { statusCode, errorMessage };
}

function extractInputBindings(stmtCode = "") {
  const fields = [];
  let source = null;

  const destructMatch = stmtCode.match(/\{\s*([^}]+)\s*\}\s*=\s*req\.(body|params|query|headers)/);
  if (destructMatch) {
    source = destructMatch[2];
    const parts = destructMatch[1]
      .split(",")
      .map((s) => s.trim().split(/[:=]/)[0].trim())
      .filter(Boolean);
    fields.push(...parts);
  }
  const directMatches = [...stmtCode.matchAll(/\breq\.(body|params|query|headers)\.([a-zA-Z0-9_]+)/g)];
  for (const m of directMatches) {
    if (!source) source = m[1];
    fields.push(m[2]);
  }
  if (!source && /\breq\.(body|params|query|headers)\b/.test(stmtCode)) {
    const m = stmtCode.match(/\breq\.(body|params|query|headers)\b/);
    source = m?.[1] || "body";
  }

  // Track simple local variable normalization: const cleanHoTen = (HoTen || "").trim()
  const varAliases = {};
  const assignMatch = stmtCode.match(/(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*([\s\S]+)/);
  if (assignMatch && !destructMatch) {
    const localVar = assignMatch[1];
    const rhs = assignMatch[2];
    const reqProp = rhs.match(/\breq\.(body|params|query|headers)\.([a-zA-Z0-9_]+)/);
    if (reqProp) {
      varAliases[localVar] = { source: reqProp[1], field: reqProp[2] };
    } else {
      const refField = rhs.match(/\b([A-Za-z_][a-zA-Z0-9_]*)\b/);
      if (refField && refField[1] !== "Number" && refField[1] !== "parseInt" && refField[1] !== "String") {
        varAliases[localVar] = { source: "derived", field: refField[1] };
      }
    }
  }

  return { source, fields: [...new Set(fields)], varAliases };
}

/**
 * Extracts a code-faithful sequence of execution steps directly from an endpoint's
 * handler AST (and optional service method AST), so every API endpoint gets its OWN
 * unique diagram matching its actual implementation.
 */
export function extractHandlerCodeFlow(snippet = "", { baseLine = 1, serviceDetails = null } = {}) {
  const { ast, code, lineOffset } = parseSnippetWithFallback(snippet);
  const bodyBlock = findPrimaryHandlerBody(ast);

  const flowSteps = [];
  const inputAliases = {};
  let catchInfo = null;
  let successResponse = { statusCode: 200, message: null, line: baseLine };

  if (!bodyBlock || !Array.isArray(bodyBlock.body)) {
    return { flowSteps, inputAliases, catchInfo, successResponse };
  }

  let statements = bodyBlock.body;
  // Unwrap top-level try { ... } catch (err) { ... } so we trace the try body linearly
  const tryStmt = statements.find((s) => s.type === "TryStatement");
  if (tryStmt && tryStmt.block?.body) {
    const beforeTry = statements.slice(0, statements.indexOf(tryStmt));
    const afterTry = statements.slice(statements.indexOf(tryStmt) + 1);
    statements = [...beforeTry, ...tryStmt.block.body, ...afterTry];

    if (tryStmt.handler?.body) {
      const catchCode = sliceNodeSource(code, tryStmt.handler.body, 400);
      const { statusCode, errorMessage } = extractStatusAndMessage(catchCode);
      catchInfo = {
        hasTryCatch: true,
        statusCode: statusCode || 500,
        errorMessage,
        line: baseLine + (tryStmt.handler.loc?.start?.line || 1) - 1 - lineOffset,
        snippet: code.slice(tryStmt.handler.start, tryStmt.handler.end),
      };
    }
  }

  let pendingInputFields = [];
  let pendingInputSources = new Set();
  let pendingInputLine = null;
  let pendingInputSnippets = [];

  const flushPendingInput = () => {
    if (pendingInputFields.length === 0 && pendingInputSources.size === 0) return;
    const sourcesLabel = [...pendingInputSources].join(", ") || "body";
    const fieldsPreview =
      pendingInputFields.length > 0
        ? pendingInputFields.slice(0, 4).join(", ") +
          (pendingInputFields.length > 4 ? ` (+${pendingInputFields.length - 4})` : "")
        : `req.${sourcesLabel}`;

    flowSteps.push({
      kind: "INPUT",
      title: `Parse ${sourcesLabel}`,
      subtitle: fieldsPreview,
      line: pendingInputLine,
      snippet: pendingInputSnippets.join("\n"),
      meta: {
        sources: [...pendingInputSources],
        fields: [...pendingInputFields],
      },
    });
    pendingInputFields = [];
    pendingInputSources = new Set();
    pendingInputLine = null;
    pendingInputSnippets = [];
  };

  for (const stmt of statements) {
    const stmtRaw = code.slice(stmt.start, stmt.end);
    const stmtCompact = stmtRaw.replace(/\s+/g, " ").trim();
    const stmtLine = baseLine + (stmt.loc?.start?.line || 1) - 1 - lineOffset;

    // 1. Variable Declarations: detect Input parsing, DB calls, Service calls, Transforms
    if (stmt.type === "VariableDeclaration") {
      const dbCall = detectDbCallInText(stmtCompact);
      if (dbCall) {
        flushPendingInput();
        const varName = stmt.declarations?.[0]?.id?.name || null;
        flowSteps.push({
          kind: "DATABASE",
          title: dbCall.operation,
          subtitle: `${dbCall.orm} · ${dbCall.model}.${dbCall.method}`,
          line: stmtLine,
          snippet: stmtRaw,
          meta: { ...dbCall, resultVar: varName },
        });
        continue;
      }

      // Check service layer call
      if (
        serviceDetails?.hasService &&
        serviceDetails.methodName &&
        stmtCompact.includes(serviceDetails.methodName)
      ) {
        flushPendingInput();
        flowSteps.push({
          kind: "SERVICE",
          title: serviceDetails.name,
          subtitle: `${serviceDetails.filePath}:${serviceDetails.lineStart}`,
          line: stmtLine,
          snippet: stmtRaw,
          filePath: serviceDetails.filePath,
          serviceLine: serviceDetails.lineStart,
          meta: { serviceName: serviceDetails.name },
        });
        // Also inline DB operations discovered inside the service method
        for (const op of serviceDetails.dbOperations || []) {
          const parsedOp = detectDbCallInText(op);
          if (parsedOp) {
            flowSteps.push({
              kind: "DATABASE",
              title: parsedOp.operation,
              subtitle: `${parsedOp.orm} (via service)`,
              line: serviceDetails.lineStart,
              snippet: serviceDetails.snippet,
              filePath: serviceDetails.filePath,
              meta: parsedOp,
            });
          }
        }
        continue;
      }

      const inp = extractInputBindings(stmtCompact);
      if (inp.source || inp.fields.length > 0 || Object.keys(inp.varAliases).length > 0) {
        if (inp.source) pendingInputSources.add(inp.source);
        pendingInputFields.push(...inp.fields);
        Object.assign(inputAliases, inp.varAliases);
        if (!pendingInputLine) pendingInputLine = stmtLine;
        pendingInputSnippets.push(stmtRaw);
        continue;
      }

      // Check local derived sanitization referencing an input field
      const simpleDeriv = stmtCompact.match(/^(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
      if (simpleDeriv) {
        const localName = simpleDeriv[1];
        const rhs = simpleDeriv[2];
        const matchedField = pendingInputFields.find((f) => new RegExp(`\\b${f}\\b`).test(rhs));
        if (matchedField) {
          inputAliases[localName] = { source: "derived", field: matchedField };
          pendingInputSnippets.push(stmtRaw);
          continue;
        }
        // Check meaningful data transform (.map / .reduce / .filter / jwt / bcrypt / fetch / axios)
        if (/\.(map|reduce|filter)\s*\(/.test(rhs) || /\b(bcrypt|jwt|fetch|axios)\b/.test(rhs)) {
          flushPendingInput();
          const opLabel = /\bbcrypt\b/.test(rhs)
            ? "Verify / Hash Password"
            : /\bjwt\b/.test(rhs)
              ? "Sign / Verify JWT"
              : /\b(fetch|axios)\b/.test(rhs)
                ? "External HTTP Call"
                : `Transform ${localName}`;
          flowSteps.push({
            kind: "PROCESS",
            title: opLabel,
            subtitle: sliceNodeSource(code, stmt, 55),
            line: stmtLine,
            snippet: stmtRaw,
            meta: { varName: localName },
          });
        }
      }
      continue;
    }

    // 2. IfStatement -> DECISION branch node
    if (stmt.type === "IfStatement") {
      flushPendingInput();
      const condText = sliceNodeSource(code, stmt.test, 75) || "condition";
      const consRaw = code.slice(stmt.consequent.start, stmt.consequent.end);
      const { statusCode, errorMessage } = extractStatusAndMessage(consRaw);
      const dbInConsequent = detectDbCallInText(consRaw);

      if (statusCode) {
        flowSteps.push({
          kind: "DECISION",
          title: `if (${condText})`,
          subtitle: `True ➔ HTTP ${statusCode}`,
          line: stmtLine,
          snippet: stmtRaw,
          meta: {
            condition: condText,
            trueStatus: statusCode,
            errorMessage,
            isEarlyReturn: true,
          },
        });
      } else {
        flowSteps.push({
          kind: "DECISION",
          title: `if (${condText})`,
          subtitle: dbInConsequent ? `Branch ➔ ${dbInConsequent.operation}` : "Conditional branch",
          line: stmtLine,
          snippet: stmtRaw,
          meta: {
            condition: condText,
            trueStatus: null,
            errorMessage: null,
            isEarlyReturn: false,
          },
        });
        if (dbInConsequent) {
          flowSteps.push({
            kind: "DATABASE",
            title: dbInConsequent.operation,
            subtitle: `${dbInConsequent.orm} (conditional)`,
            line: stmtLine,
            snippet: consRaw,
            meta: dbInConsequent,
          });
        }
      }
      continue;
    }

    // 3. ExpressionStatement / ReturnStatement
    if (stmt.type === "ExpressionStatement" || stmt.type === "ReturnStatement") {
      // Check DB call
      const dbCall = detectDbCallInText(stmtCompact);
      if (dbCall) {
        flushPendingInput();
        flowSteps.push({
          kind: "DATABASE",
          title: dbCall.operation,
          subtitle: `${dbCall.orm} · ${dbCall.model}.${dbCall.method}`,
          line: stmtLine,
          snippet: stmtRaw,
          meta: dbCall,
        });
        continue;
      }

      // Check service call
      if (
        serviceDetails?.hasService &&
        serviceDetails.methodName &&
        stmtCompact.includes(serviceDetails.methodName)
      ) {
        flushPendingInput();
        flowSteps.push({
          kind: "SERVICE",
          title: serviceDetails.name,
          subtitle: `${serviceDetails.filePath}:${serviceDetails.lineStart}`,
          line: stmtLine,
          snippet: stmtRaw,
          filePath: serviceDetails.filePath,
          serviceLine: serviceDetails.lineStart,
          meta: { serviceName: serviceDetails.name },
        });
        continue;
      }

      // Check Cache invalidation / external side-effect (skip console.log)
      if (
        /\b(responseCache|cache|redis)\.(invalidate|del|set|clear)\s*\(/i.test(stmtCompact)
      ) {
        flushPendingInput();
        const cacheCall = stmtCompact.match(/([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\([^)]*\))/);
        flowSteps.push({
          kind: "PROCESS",
          title: "Cache Operation",
          subtitle: cacheCall ? cacheCall[1] : "Update / Invalidate Cache",
          line: stmtLine,
          snippet: stmtRaw,
          meta: {},
        });
        continue;
      }

      // Check final res.status(...).json(...) or res.json(...)
      if (/\bres\.(?:status|sendStatus|json|send|end)\b/.test(stmtCompact)) {
        flushPendingInput();
        const { statusCode, errorMessage } = extractStatusAndMessage(stmtCompact);
        if (statusCode && statusCode < 400) {
          successResponse = {
            statusCode,
            message: errorMessage,
            line: stmtLine,
            snippet: stmtRaw,
          };
        }
      }
    }
  }

  flushPendingInput();

  return {
    flowSteps,
    inputAliases,
    catchInfo,
    successResponse,
  };
}

/**
 * Inspects a service file/method referenced by a controller to discover
 * Prisma/ORM database models, DB operations, and snippet.
 */
function inspectServiceLayerDetails(endpoint = {}, sourceFiles = []) {
  const serviceLayer =
    endpoint.serviceLayer || endpoint.requestProcessingChain?.serviceLayer || null;
  if (!serviceLayer || serviceLayer.status !== "FOUND_IN_SOURCE" || !serviceLayer.file) {
    return {
      hasService: false,
      name: null,
      methodName: null,
      filePath: null,
      lineStart: null,
      snippet: "",
      databaseModels: [],
      dbOperations: [],
    };
  }

  const serviceFile = findSourceFile(sourceFiles, serviceLayer.file);
  const lineStart = serviceLayer.lineStart || 1;
  const snippet = serviceFile?.content
    ? extractLineWindow(serviceFile.content, lineStart, 35)
    : "";

  const databaseModels = [];
  const dbOperations = [];
  if (snippet) {
    const prismaRegex = /prisma\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\(/g;
    let pm;
    while ((pm = prismaRegex.exec(snippet)) !== null) {
      databaseModels.push(pm[1]);
      dbOperations.push(`prisma.${pm[1]}.${pm[2]}()`);
    }
    const mongooseRegex = /\b([A-Z][a-zA-Z0-9_]+)\.(find|findOne|findById|findByIdAndUpdate|findByIdAndDelete|create|updateOne|deleteOne|save)\s*\(/g;
    let mm;
    while ((mm = mongooseRegex.exec(snippet)) !== null) {
      databaseModels.push(mm[1]);
      dbOperations.push(`${mm[1]}.${mm[2]}()`);
    }
  }

  const nameParts = String(serviceLayer.name || "").split(".");
  const methodName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : serviceLayer.name;

  return {
    hasService: true,
    name: serviceLayer.name || "serviceHandler",
    methodName,
    filePath: cleanStoragePath(serviceLayer.file) || serviceLayer.file,
    lineStart,
    snippet,
    databaseModels: [...new Set(databaseModels)],
    dbOperations: [...new Set(dbOperations)],
  };
}

/**
 * Extracts HTTP headers, auth presence, payload, query params, and DB mock signals
 * from an individual test scenario code snippet using Babel AST.
 */
export function extractScenarioHttpDetails(scenario = {}, endpoint = {}) {
  const code = scenario.code || "";
  const method = (scenario.method || endpoint.method || "GET").toUpperCase();
  const pathStr = scenario.path || endpoint.path || endpoint.fullPath || "/";

  let parsedReq = null;
  if (code.trim()) {
    try {
      const reqs = extractTestRequests(code, scenario.filePath || "scenario.test.js");
      parsedReq = reqs?.[0] || null;
    } catch (err) {
      console.warn("[IntegrationSimulation] AST request extraction fallback:", err.message);
    }
  }

  const headers = {};
  let hasAuthHeader = false;
  let mocksDbError = false;

  if (code.trim()) {
    const parsed = parseJavaScriptCode(code);
    if (parsed.success && parsed.ast) {
      try {
        traverse(parsed.ast, {
          CallExpression(p) {
            const prop = p.node.callee?.property?.name;
            if (prop === "set" && p.node.arguments.length >= 1) {
              const first = p.node.arguments[0];
              const second = p.node.arguments[1];
              if (first?.type === "StringLiteral" && second) {
                const val =
                  second.type === "StringLiteral"
                    ? second.value
                    : second.type === "TemplateLiteral"
                      ? "Bearer <token>"
                      : "<dynamic>";
                headers[first.value] = val;
              } else if (first?.type === "ObjectExpression") {
                for (const objProp of first.properties || []) {
                  const key = objProp.key?.name || objProp.key?.value;
                  if (key) {
                    headers[key] =
                      objProp.value?.type === "StringLiteral"
                        ? objProp.value.value
                        : "<dynamic>";
                  }
                }
              }
            }
            if (prop === "mockRejectedValue" || prop === "mockRejectedValueOnce") {
              mocksDbError = true;
            }
          },
          ObjectProperty(p) {
            const key = p.node.key?.name || p.node.key?.value;
            if (key === "headers" && p.node.value?.type === "ObjectExpression") {
              for (const hp of p.node.value.properties || []) {
                const hk = hp.key?.name || hp.key?.value;
                if (hk) {
                  headers[hk] =
                    hp.value?.type === "StringLiteral" ? hp.value.value : "<dynamic>";
                }
              }
            }
          },
        });
      } catch (err) {
        console.warn("[IntegrationSimulation] AST header traverse warning:", err.message);
      }
    }

    if (
      /authorization|bearer|x-auth-token|cookie/i.test(JSON.stringify(headers)) ||
      /\.set\(\s*['"`]Authorization['"`]/i.test(code) ||
      /\.set\(\s*['"`]Cookie['"`]/i.test(code)
    ) {
      hasAuthHeader = true;
    }
    if (/mockRejectedValue|ECONNREFUSED|database.*error/i.test(code)) {
      mocksDbError = true;
    }
  }

  const expectedStatus =
    scenario.expectedStatus ??
    parsedReq?.expectedStatus ??
    (Array.isArray(scenario.expectedStatuses) ? scenario.expectedStatuses[0] : null) ??
    (Array.isArray(parsedReq?.expectedStatuses) ? parsedReq.expectedStatuses[0] : null) ??
    null;

  const expectedStatuses =
    scenario.expectedStatuses ||
    parsedReq?.expectedStatuses ||
    (expectedStatus ? [expectedStatus] : []);

  return {
    method,
    path: parsedReq?.path && parsedReq.path !== "mappingUnavailable" ? parsedReq.path : pathStr,
    headers,
    hasAuthHeader,
    payload: scenario.payload ?? parsedReq?.payload ?? null,
    queryParams: scenario.queryParams ?? parsedReq?.queryParams ?? null,
    expectedStatus,
    expectedStatuses,
    mocksDbError,
  };
}

/**
 * Builds ONE unique, code-driven flow graph for a specific API endpoint,
 * reflecting that endpoint's actual middlewares, input parsing, if/else branches,
 * service calls, database operations, and try/catch paths.
 * All test scenarios belonging to this endpoint reuse this exact API graph.
 */
export function buildApiSimulationGraph({ endpoint = {}, sourceFiles = [] } = {}) {
  const method = (endpoint.method || "GET").toUpperCase();
  const routePath = endpoint.path || endpoint.fullPath || "/";
  const chain = endpoint.requestProcessingChain || {};
  const source = endpoint.source || {};

  const routeReg = chain.routeRegistration || {};
  const routeFile =
    cleanStoragePath(routeReg.sourceFile || source.sourceFile || endpoint.sourceFile || "") ||
    "express-router";
  const routeLine = routeReg.sourceLineStart || source.sourceLine || endpoint.sourceLine || 1;
  const routeSnippet =
    routeReg.routeSnippet || source.routeSnippet || endpoint.routeSnippet || "";

  const rawMiddlewares =
    (Array.isArray(chain.middlewares) && chain.middlewares.length > 0
      ? chain.middlewares
      : Array.isArray(source.middlewares) && source.middlewares.length > 0
        ? source.middlewares
        : endpoint.middlewares) || [];

  const controllerInfo = chain.controllerHandler || chain.controller || {};
  const controllerName =
    controllerInfo.name || endpoint.controller || endpoint.controllerMethod || "routeHandler";
  const controllerFile =
    cleanStoragePath(controllerInfo.file || source.controllerFile || endpoint.controllerFile || "") ||
    routeFile;
  const controllerLine =
    controllerInfo.lineStart ||
    source.controllerLineStart ||
    source.controllerLine ||
    endpoint.controllerLine ||
    routeLine;
  const controllerSnippet =
    controllerInfo.snippet || source.controllerSnippet || endpoint.controllerSnippet || routeSnippet;

  const serviceDetails = inspectServiceLayerDetails(
    {
      ...endpoint,
      serviceLayer: chain.serviceLayer || chain.service || endpoint.serviceLayer,
    },
    sourceFiles,
  );

  // Extract the sequential AST code flow specific to THIS API endpoint!
  const { flowSteps, inputAliases, catchInfo, successResponse } = extractHandlerCodeFlow(
    controllerSnippet,
    {
      baseLine: controllerLine,
      serviceDetails,
    },
  );

  const nodes = [];
  const edges = [];

  // 1. Client Node
  nodes.push({
    id: "client",
    kind: "CLIENT",
    layer: "Client",
    title: "Test Client",
    subtitle: `${method} ${routePath}`,
    meta: { method, path: routePath },
  });

  // 2. Express Router Node
  nodes.push({
    id: "router",
    kind: "ROUTER",
    layer: "Router",
    title: `${method} ${routePath}`,
    subtitle: `${routeFile}:${routeLine}`,
    filePath: routeFile !== "express-router" ? routeFile : null,
    line: routeLine,
    snippet: routeSnippet,
    meta: { mountPrefix: routeReg.mountPrefix || "/" },
  });

  edges.push({
    id: "e_client_router",
    from: "client",
    to: "router",
    kind: "forward",
    label: `${method} ${routePath}`,
  });

  // Router 404 unmounted/not-matched edge -> response
  edges.push({
    id: "e_router_response_404",
    from: "router",
    to: "response",
    kind: "error",
    label: "404 Route Not Found",
  });

  let prevNodeId = "router";
  let prevEdgeLabel = "Route matched";

  // 3. Middleware Chain Nodes
  const middlewareNodeIds = [];
  rawMiddlewares.forEach((rawMw, idx) => {
    const mw =
      typeof rawMw === "string"
        ? { name: rawMw, type: "CUSTOM_MIDDLEWARE", file: null, line: null }
        : rawMw;
    const mwId = `mw_${idx}`;
    const mwFileObj = mw.file ? findSourceFile(sourceFiles, mw.file) : null;
    const mwSnippet =
      mwFileObj?.content && mw.line
        ? extractLineWindow(mwFileObj.content, mw.line, 18)
        : "";
    const mwType = mw.type || "CUSTOM_MIDDLEWARE";

    nodes.push({
      id: mwId,
      kind: "MIDDLEWARE",
      layer: "Middleware",
      middlewareType: mwType,
      title: mw.name || `middleware_${idx + 1}`,
      subtitle:
        mwType === "AUTHENTICATION"
          ? "Auth / JWT Guard"
          : mwType === "VALIDATION"
            ? "Schema Validator"
            : "Middleware",
      filePath: mw.file ? cleanStoragePath(mw.file) || mw.file : null,
      line: mw.line || null,
      snippet: mwSnippet,
      meta: { middlewareType: mwType },
    });

    edges.push({
      id: `e_${prevNodeId}_${mwId}`,
      from: prevNodeId,
      to: mwId,
      kind: "forward",
      label: prevEdgeLabel,
    });

    const rejectLabel =
      mwType === "AUTHENTICATION"
        ? "401 / 403 Unauthorized"
        : mwType === "VALIDATION"
          ? "400 / 422 Invalid"
          : "4xx Rejected";
    edges.push({
      id: `e_${mwId}_response_reject`,
      from: mwId,
      to: "response",
      kind: "reject",
      label: rejectLabel,
    });

    middlewareNodeIds.push({ id: mwId, type: mwType, name: mw.name });
    prevNodeId = mwId;
    prevEdgeLabel = "next()";
  });

  // 4. Code-driven Handler / Service / Decision / DB Nodes
  const dbModels = new Set(
    chain.dataAccess?.models || source.databaseModels || endpoint.databaseModels || [],
  );

  // If AST didn't extract granular steps (e.g. missing snippet), fall back to Controller (+ Service/DB if known)
  if (flowSteps.length === 0) {
    nodes.push({
      id: "controller",
      kind: "CONTROLLER",
      layer: "Handler",
      title: controllerName,
      subtitle: `${controllerFile}:${controllerLine}`,
      filePath: controllerFile !== "express-router" ? controllerFile : null,
      line: controllerLine,
      snippet: controllerSnippet,
      meta: {
        responseStatusCodes:
          endpoint.behaviorEvidence?.responseStatusCodes ||
          source.responseStatusCodes ||
          [200],
      },
    });
    edges.push({
      id: `e_${prevNodeId}_controller`,
      from: prevNodeId,
      to: "controller",
      kind: "forward",
      label: prevEdgeLabel,
    });
    edges.push({
      id: "e_controller_response_guard",
      from: "controller",
      to: "response",
      kind: "reject",
      label: "Guard / Error",
    });
    prevNodeId = "controller";
    prevEdgeLabel = `${successResponse.statusCode || 200} OK`;
  } else {
    // Emit each extracted code step as a node in THIS API's unique flow diagram!
    // Cap at 14 steps to keep large handlers legible.
    const stepsToRender = flowSteps.slice(0, 14);
    let hasServiceNode = false;

    stepsToRender.forEach((step, idx) => {
      const nodeId = `step_${idx}`;
      if (step.kind === "SERVICE") hasServiceNode = true;
      if (step.kind === "DATABASE" && step.meta?.model) {
        dbModels.add(step.meta.model);
      }

      const layerLabelMap = {
        INPUT: "Input",
        DECISION: "Condition",
        DATABASE: step.meta?.orm || "Database",
        SERVICE: "Service",
        PROCESS: "Process",
      };

      nodes.push({
        id: nodeId,
        kind: step.kind,
        layer: layerLabelMap[step.kind] || "Handler",
        title: step.title,
        subtitle: step.subtitle,
        filePath:
          step.filePath ||
          (controllerFile !== "express-router" ? controllerFile : null),
        line: step.serviceLine || step.line || controllerLine,
        snippet: step.snippet || "",
        meta: {
          ...step.meta,
          stepIdx: idx,
          handlerName: controllerName,
        },
      });

      edges.push({
        id: `e_${prevNodeId}_${nodeId}`,
        from: prevNodeId,
        to: nodeId,
        kind: "forward",
        label: prevEdgeLabel,
      });

      if (step.kind === "DECISION" && step.meta?.trueStatus) {
        edges.push({
          id: `e_${nodeId}_response_true`,
          from: nodeId,
          to: "response",
          kind: step.meta.trueStatus >= 500 ? "error" : "reject",
          label: `True ➔ ${step.meta.trueStatus}`,
        });
        prevEdgeLabel = "False";
      } else if (step.kind === "DATABASE") {
        if (catchInfo?.hasTryCatch) {
          edges.push({
            id: `e_${nodeId}_response_catch`,
            from: nodeId,
            to: "response",
            kind: "error",
            label: `catch ➔ ${catchInfo.statusCode || 500}`,
          });
        }
        prevEdgeLabel = "Result";
      } else {
        prevEdgeLabel = "Next";
      }

      prevNodeId = nodeId;
    });

    // If service layer exists and wasn't explicitly matched by name in handler statements,
    // append it before response so layered architectures remain represented
    if (serviceDetails.hasService && !hasServiceNode) {
      nodes.push({
        id: "service",
        kind: "SERVICE",
        layer: "Service",
        title: serviceDetails.name,
        subtitle: `${serviceDetails.filePath}:${serviceDetails.lineStart}`,
        filePath: serviceDetails.filePath,
        line: serviceDetails.lineStart,
        snippet: serviceDetails.snippet,
        meta: {},
      });
      edges.push({
        id: `e_${prevNodeId}_service`,
        from: prevNodeId,
        to: "service",
        kind: "forward",
        label: prevEdgeLabel,
      });
      prevNodeId = "service";
      prevEdgeLabel = "Return";
    }
  }

  // Catch-all error edge from last backend node if try/catch exists and no DB node already added catch edge
  const hasCatchEdgeAlready = edges.some((e) => e.id.endsWith("_response_catch"));
  if (catchInfo?.hasTryCatch && !hasCatchEdgeAlready && prevNodeId !== "client" && prevNodeId !== "router") {
    edges.push({
      id: `e_${prevNodeId}_response_catch`,
      from: prevNodeId,
      to: "response",
      kind: "error",
      label: `catch ➔ ${catchInfo.statusCode || 500}`,
    });
  }

  // Response Node
  const allStatusCodes = [
    ...new Set([
      successResponse.statusCode || 200,
      ...flowSteps
        .filter((s) => s.kind === "DECISION" && s.meta?.trueStatus)
        .map((s) => s.meta.trueStatus),
      ...(catchInfo?.hasTryCatch ? [catchInfo.statusCode || 500] : []),
      ...(endpoint.behaviorEvidence?.responseStatusCodes || []),
    ]),
  ].sort((a, b) => a - b);

  nodes.push({
    id: "response",
    kind: "RESPONSE",
    layer: "Response",
    title: "HTTP Response",
    subtitle: `Status ${allStatusCodes.join(" / ")}`,
    filePath: controllerFile !== "express-router" ? controllerFile : null,
    line: successResponse.line || controllerLine,
    snippet: successResponse.snippet || "",
    meta: {
      responseStatusCodes: allStatusCodes,
      successStatus: successResponse.statusCode || 200,
      catchInfo,
    },
  });

  const okStatus = successResponse.statusCode || (method === "POST" ? 201 : 200);
  edges.push({
    id: `e_${prevNodeId}_response_ok`,
    from: prevNodeId,
    to: "response",
    kind: "success",
    label: `${okStatus} Response`,
  });

  // Assertion Node
  nodes.push({
    id: "assertion",
    kind: "ASSERTION",
    layer: "Test Assertion",
    title: "Test Assertion",
    subtitle: "expect(res.status / body)",
    meta: {},
  });

  edges.push({
    id: "e_response_assertion",
    from: "response",
    to: "assertion",
    kind: "forward",
    label: "Verify contract",
  });

  return {
    endpointKey: `${method} ${routePath}`,
    method,
    path: routePath,
    nodes,
    edges,
    metadata: {
      hasMiddlewares: middlewareNodeIds.length > 0,
      hasService: serviceDetails.hasService,
      hasDatabase: dbModels.size > 0 || nodes.some((n) => n.kind === "DATABASE"),
      databaseModels: [...dbModels],
      branchesCount: nodes.filter((n) => n.kind === "DECISION").length,
      inputAliases,
      catchInfo,
      successStatus: okStatus,
    },
  };
}

function resolveScenarioCategoryAndStatus(scenario = {}, httpDetails = {}, successStatus = 200) {
  const caseKey = getScenarioCaseKey(scenario);
  const catInfo = classifyScenario(scenario);
  const expectedStatus = Number(httpDetails.expectedStatus || 0);
  const actualStatus = Number(scenario.actualStatus || scenario.responseStatus || 0);

  let inferredStatus = expectedStatus || actualStatus || 0;
  if (!inferredStatus) {
    if (caseKey === "AUTH") inferredStatus = 401;
    else if (caseKey === "VALIDATION") inferredStatus = 400;
    else if (caseKey === "NOT_FOUND") inferredStatus = 404;
    else if (caseKey === "EDGE") inferredStatus = 500;
    else inferredStatus = successStatus || (httpDetails.method === "POST" ? 201 : 200);
  }

  return {
    caseKey,
    categoryLabel: catInfo.label,
    expectedStatus: expectedStatus || inferredStatus,
    actualStatus: actualStatus || null,
    inferredStatus,
  };
}

/**
 * Evaluates which specific DECISION node in THIS API's code graph is triggered
 * by the given scenario's payload, path params, expected status, or title/code hints.
 */
function pickTriggeredDecisionNode(
  decisionNodes = [],
  { targetStatus, httpDetails, inputAliases = {}, scenario = {}, routePath = "/" },
) {
  if (!decisionNodes.length) return null;

  // Filter candidates matching the status code first (or same 4xx class)
  let candidates = decisionNodes.filter(
    (n) => Number(n.meta?.trueStatus) === Number(targetStatus),
  );
  if (candidates.length === 0 && targetStatus >= 400 && targetStatus < 500) {
    candidates = decisionNodes.filter(
      (n) => n.meta?.trueStatus >= 400 && n.meta?.trueStatus < 500,
    );
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const payload = httpDetails.payload && typeof httpDetails.payload === "object"
    ? httpDetails.payload
    : null;
  const query = httpDetails.queryParams && typeof httpDetails.queryParams === "object"
    ? httpDetails.queryParams
    : null;
  const scenarioText = `${scenario.title || ""} ${scenario.testName || ""} ${
    scenario.responseData?.message || ""
  } ${scenario.code || ""}`.toLowerCase();

  // Extract dynamic route param value if route has :param (e.g. /api/students/:id vs /api/students/abc)
  const routeSegs = normalizePathKey(routePath).split("/").filter(Boolean);
  const reqSegs = normalizePathKey(httpDetails.path).split("/").filter(Boolean);
  const paramValues = {};
  routeSegs.forEach((seg, idx) => {
    if (seg.startsWith(":") && reqSegs[idx] !== undefined) {
      paramValues[seg.slice(1)] = reqSegs[idx];
    }
  });

  // Resolve value for a variable name from payload / query / params
  const resolveFieldValue = (varName) => {
    const alias = inputAliases[varName];
    const fieldName = alias?.field || varName;
    if (payload && Object.prototype.hasOwnProperty.call(payload, fieldName)) {
      return { found: true, value: payload[fieldName] };
    }
    if (query && Object.prototype.hasOwnProperty.call(query, fieldName)) {
      return { found: true, value: query[fieldName] };
    }
    if (Object.prototype.hasOwnProperty.call(paramValues, fieldName)) {
      return { found: true, value: paramValues[fieldName] };
    }
    if (payload && !Object.prototype.hasOwnProperty.call(payload, fieldName) && alias?.source !== "params") {
      return { found: true, value: undefined };
    }
    return { found: false, value: undefined };
  };

  let bestNode = null;
  let bestScore = -1;

  for (const node of candidates) {
    const cond = String(node.meta?.condition || "");
    const errMsg = String(node.meta?.errorMessage || "").toLowerCase();
    let score = 0;

    // 1. Check `!varName` against payload/param missing or empty string
    const negMatch = cond.match(/^!\s*([a-zA-Z0-9_]+)$/);
    if (negMatch) {
      const varName = negMatch[1];
      const resolved = resolveFieldValue(varName);
      if (resolved.found) {
        const isFalsy =
          resolved.value === undefined ||
          resolved.value === null ||
          resolved.value === "" ||
          resolved.value === false;
        if (isFalsy) score += 25;
        else score -= 5; // payload actually provided a truthy value for this field!
      }
    }

    // 2. Check `isNaN(varName)` / numeric range (`< 0`, `> 10`, etc.)
    const nanMatch = cond.match(/isNaN\(\s*([a-zA-Z0-9_]+)\s*\)/);
    if (nanMatch) {
      const varName = nanMatch[1];
      const resolved = resolveFieldValue(varName);
      if (resolved.found && resolved.value !== undefined) {
        const num = Number(resolved.value);
        if (Number.isNaN(num)) score += 30;
        else {
          const ltMatch = cond.match(/<\s*(-?\d+(?:\.\d+)?)/);
          const gtMatch = cond.match(/>\s*(-?\d+(?:\.\d+)?)/);
          if ((ltMatch && num < Number(ltMatch[1])) || (gtMatch && num > Number(gtMatch[1]))) {
            score += 30;
          } else {
            score -= 5;
          }
        }
      }
    }

    // 3. Check exact errorMessage / condition token overlap with scenario title/response
    if (errMsg && scenario.responseData?.message) {
      const actualMsg = String(scenario.responseData.message).toLowerCase();
      if (actualMsg.includes(errMsg) || errMsg.includes(actualMsg)) {
        score += 50;
      }
    }
    const tokens = `${cond} ${errMsg}`
      .toLowerCase()
      .split(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]+/)
      .filter((t) => t.length >= 3);
    for (const tok of tokens) {
      if (scenarioText.includes(tok)) score += 4;
    }

    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  return bestNode || candidates[0];
}

/**
 * Generates discrete simulation steps over THIS API endpoint's unique code graph
 * for a specific Test Scenario (0 AI tokens).
 */
export function buildIntegrationScenarioTrace({
  endpoint = {},
  scenario = {},
  graph = null,
  sourceFiles = [],
} = {}) {
  const sharedGraph = graph || buildApiSimulationGraph({ endpoint, sourceFiles });
  const { nodes, edges, metadata } = sharedGraph;

  const httpDetails = extractScenarioHttpDetails(scenario, endpoint);
  const {
    caseKey,
    categoryLabel,
    expectedStatus,
    actualStatus,
    inferredStatus,
  } = resolveScenarioCategoryAndStatus(scenario, httpDetails, metadata?.successStatus || 200);

  const rawStatus = String(scenario.status || "").toUpperCase();
  const isRecordedRun =
    rawStatus === "PASSED" ||
    rawStatus === "PASS" ||
    rawStatus === "FAILED" ||
    rawStatus === "FAIL";
  const isRecordedFail = rawStatus === "FAILED" || rawStatus === "FAIL";
  const failureLayer = isRecordedFail ? scenario.failureLayer || null : null;

  const effectiveStatus = actualStatus || expectedStatus || inferredStatus;
  const mwNodes = nodes.filter((n) => n.kind === "MIDDLEWARE");
  const authMwNode = mwNodes.find((n) => n.middlewareType === "AUTHENTICATION");
  const validationMwNode = mwNodes.find((n) => n.middlewareType === "VALIDATION");
  const decisionNodes = nodes.filter((n) => n.kind === "DECISION");
  const routerNode = nodes.find((n) => n.id === "router");
  const responseNode = nodes.find((n) => n.id === "response");

  // Pipeline nodes between middlewares and response (INPUT, DECISION, DATABASE, SERVICE, PROCESS, CONTROLLER)
  const backendNodes = nodes.filter(
    (n) =>
      !["CLIENT", "ROUTER", "MIDDLEWARE", "RESPONSE", "ASSERTION"].includes(n.kind),
  );

  // Determine which specific DECISION node triggers for this scenario (if any)
  const triggeredDecision =
    effectiveStatus >= 400 && failureLayer !== "ROUTER_NOT_FOUND" && failureLayer !== "MIDDLEWARE_REJECTED"
      ? pickTriggeredDecisionNode(decisionNodes, {
          targetStatus: effectiveStatus,
          httpDetails,
          inputAliases: metadata?.inputAliases || {},
          scenario,
          routePath: sharedGraph.path,
        })
      : null;

  const steps = [];
  const pushStep = (step) => {
    steps.push({
      stepIndex: steps.length,
      ...step,
      requestState: {
        method: httpDetails.method,
        path: httpDetails.path,
        headers: httpDetails.headers,
        queryParams: httpDetails.queryParams,
        payload: httpDetails.payload,
      },
    });
  };

  // Step 0: Client Request
  pushStep({
    nodeId: "client",
    edgeId: null,
    direction: "forward",
    phase: "CLIENT_REQUEST",
    status: "ACTIVE",
    statusCode: null,
    title: "Send HTTP Request",
    summary: `Test client prepares ${httpDetails.method} ${httpDetails.path}${
      httpDetails.hasAuthHeader ? " with Authorization header" : ""
    }${httpDetails.payload ? " and JSON payload" : ""}.`,
    filePath: scenario.filePath || scenario.testFile || null,
    line: null,
    codeSnippet: scenario.code || "",
    branchEvaluation: null,
    dbOperation: null,
    responseState: null,
  });

  // Step 1: Router Matching
  pushStep({
    nodeId: "router",
    edgeId: "e_client_router",
    direction: "forward",
    phase: "ROUTER_MATCH",
    status: failureLayer === "ROUTER_NOT_FOUND" ? "ERROR" : "PASS",
    statusCode: failureLayer === "ROUTER_NOT_FOUND" ? 404 : null,
    title:
      failureLayer === "ROUTER_NOT_FOUND"
        ? "Route Not Matched (404)"
        : `Matched ${routerNode?.title || sharedGraph.endpointKey}`,
    summary:
      failureLayer === "ROUTER_NOT_FOUND"
        ? `Router could not match ${httpDetails.method} ${httpDetails.path}.`
        : `Dispatched to route handler at ${routerNode?.subtitle || "router"}.`,
    filePath: routerNode?.filePath || null,
    line: routerNode?.line || null,
    codeSnippet: routerNode?.snippet || "",
    branchEvaluation: null,
    dbOperation: null,
    responseState:
      failureLayer === "ROUTER_NOT_FOUND"
        ? { statusCode: 404, error: "Route not found" }
        : null,
  });

  let stopReason = null; // "ROUTER_404" | "MW_REJECT" | "DECISION_EARLY_RETURN" | "DB_ERROR" | "CATCH_ERROR" | "CONTROLLER_ERROR"
  let responseStatusCode = effectiveStatus;
  let lastTraversedNodeId = "router";
  let triggeredNodeId = null;

  if (failureLayer === "ROUTER_NOT_FOUND") {
    stopReason = "ROUTER_404";
    responseStatusCode = actualStatus || 404;
  }

  // Step 2: Middleware Chain
  if (!stopReason) {
    for (let i = 0; i < mwNodes.length; i++) {
      const mw = mwNodes[i];
      const edgeFromPrev = `e_${lastTraversedNodeId}_${mw.id}`;

      const isAuthRejectAtMw =
        mw.middlewareType === "AUTHENTICATION" &&
        (failureLayer === "MIDDLEWARE_REJECTED" ||
          ((effectiveStatus === 401 || effectiveStatus === 403 || caseKey === "AUTH") &&
            !httpDetails.hasAuthHeader));

      const isValRejectAtMw =
        mw.middlewareType === "VALIDATION" &&
        (failureLayer === "MIDDLEWARE_REJECTED" ||
          (caseKey === "VALIDATION" && (effectiveStatus === 400 || effectiveStatus === 422)));

      const isGenericMwReject =
        failureLayer === "MIDDLEWARE_REJECTED" &&
        !authMwNode &&
        !validationMwNode &&
        i === 0;

      const rejectedHere = isAuthRejectAtMw || isValRejectAtMw || isGenericMwReject;

      pushStep({
        nodeId: mw.id,
        edgeId: edgeFromPrev,
        direction: "forward",
        phase: "MIDDLEWARE",
        status: rejectedHere ? (isRecordedFail ? "ERROR" : "BLOCKED") : "PASS",
        statusCode: rejectedHere ? effectiveStatus : null,
        title: rejectedHere
          ? `${mw.title} Rejected (${effectiveStatus})`
          : `${mw.title} Passed`,
        summary: rejectedHere
          ? `Request stopped at middleware ${mw.title} (HTTP ${effectiveStatus}).`
          : `${mw.title} verified request and called next().`,
        filePath: mw.filePath || null,
        line: mw.line || null,
        codeSnippet: mw.snippet || "",
        branchEvaluation: {
          condition: mw.subtitle,
          result: rejectedHere ? `REJECTED (${effectiveStatus})` : "PASSED",
        },
        dbOperation: null,
        responseState: rejectedHere
          ? { statusCode: effectiveStatus, blockedAt: mw.title }
          : null,
      });

      lastTraversedNodeId = mw.id;
      if (rejectedHere) {
        stopReason = "MW_REJECT";
        responseStatusCode = effectiveStatus;
        break;
      }
    }
  }

  // Step 3: Walk THIS API's specific sequential AST nodes
  if (!stopReason) {
    const isError500Target =
      failureLayer === "DATABASE_FAILURE" ||
      failureLayer === "CONTROLLER_CRASH" ||
      httpDetails.mocksDbError ||
      effectiveStatus >= 500;

    for (let i = 0; i < backendNodes.length; i++) {
      const node = backendNodes[i];
      const edgeFromPrev = `e_${lastTraversedNodeId}_${node.id}`;

      if (node.kind === "DECISION") {
        const isHit = triggeredDecision?.id === node.id;
        const hitStatus = node.meta?.trueStatus || effectiveStatus;
        pushStep({
          nodeId: node.id,
          edgeId: edgeFromPrev,
          direction: "forward",
          phase: "BRANCH_DECISION",
          status: isHit ? (hitStatus >= 500 ? "ERROR" : "BLOCKED") : "PASS",
          statusCode: isHit ? hitStatus : null,
          title: isHit
            ? `${node.title} ➔ TRUE (${hitStatus})`
            : `${node.title} ➔ FALSE`,
          summary: isHit
            ? `Condition '${node.meta?.condition}' evaluated TRUE${
                node.meta?.errorMessage ? ` ("${node.meta.errorMessage}")` : ""
              } — returning HTTP ${hitStatus}.`
            : `Condition '${node.meta?.condition}' evaluated FALSE — continuing execution.`,
          filePath: node.filePath || null,
          line: node.line || null,
          codeSnippet: node.snippet || "",
          branchEvaluation: {
            condition: node.meta?.condition || node.title,
            result: isHit
              ? `TRUE ➔ Return HTTP ${hitStatus}`
              : "FALSE (Continue)",
            statusCode: isHit ? hitStatus : null,
          },
          dbOperation: null,
          responseState: isHit
            ? { statusCode: hitStatus, message: node.meta?.errorMessage || null }
            : null,
        });

        lastTraversedNodeId = node.id;
        if (isHit && node.meta?.isEarlyReturn) {
          stopReason = "DECISION_EARLY_RETURN";
          triggeredNodeId = node.id;
          responseStatusCode = actualStatus || hitStatus;
          break;
        }
      } else if (node.kind === "DATABASE") {
        const dbNodesRemaining = backendNodes
          .slice(i + 1)
          .some((n) => n.kind === "DATABASE");
        const dbFailsHere =
          isError500Target &&
          (failureLayer === "DATABASE_FAILURE" || httpDetails.mocksDbError || !dbNodesRemaining);

        const nextDecisionIsNotFound =
          backendNodes[i + 1]?.kind === "DECISION" &&
          triggeredDecision?.id === backendNodes[i + 1]?.id;

        pushStep({
          nodeId: node.id,
          edgeId: edgeFromPrev,
          direction: "forward",
          phase: "DATABASE",
          status: dbFailsHere ? "ERROR" : "PASS",
          statusCode: dbFailsHere ? actualStatus || 500 : null,
          title: dbFailsHere ? `${node.title} Failed` : node.title,
          summary: dbFailsHere
            ? `Database operation ${node.title} threw an error and jumped to catch block.`
            : nextDecisionIsNotFound
              ? `Executed ${node.title} — returned null/empty for downstream check.`
              : `Executed ${node.title} successfully.`,
          filePath: node.filePath || null,
          line: node.line || null,
          codeSnippet: node.snippet || "",
          branchEvaluation: null,
          dbOperation: {
            orm: node.meta?.orm || "DB",
            models: node.meta?.model ? [node.meta.model] : [],
            operation: node.title,
            result: dbFailsHere
              ? "ERROR (Exception)"
              : nextDecisionIsNotFound
                ? "null / empty"
                : "OK",
          },
          responseState: dbFailsHere ? { statusCode: actualStatus || 500 } : null,
        });

        lastTraversedNodeId = node.id;
        if (dbFailsHere) {
          stopReason = "DB_ERROR";
          triggeredNodeId = node.id;
          responseStatusCode = actualStatus || 500;
          break;
        }
      } else if (node.kind === "CONTROLLER") {
        // Fallback single-controller node (when no granular AST statements existed)
        const stopsHere = effectiveStatus >= 400;
        pushStep({
          nodeId: node.id,
          edgeId: edgeFromPrev,
          direction: "forward",
          phase: "CONTROLLER",
          status:
            failureLayer === "CONTROLLER_CRASH" || effectiveStatus >= 500
              ? "ERROR"
              : stopsHere
                ? "BLOCKED"
                : "PASS",
          statusCode: stopsHere ? effectiveStatus : null,
          title: stopsHere ? `${node.title} (${effectiveStatus})` : `Execute ${node.title}`,
          summary: stopsHere
            ? `Handler returned HTTP ${effectiveStatus}.`
            : `Executed handler ${node.title}.`,
          filePath: node.filePath || null,
          line: node.line || null,
          codeSnippet: node.snippet || "",
          branchEvaluation: null,
          dbOperation: null,
          responseState: stopsHere ? { statusCode: effectiveStatus } : null,
        });

        lastTraversedNodeId = node.id;
        if (stopsHere) {
          stopReason = "CONTROLLER_ERROR";
          triggeredNodeId = node.id;
          responseStatusCode = effectiveStatus;
          break;
        }
      } else {
        // INPUT, SERVICE, PROCESS
        const crashHere =
          failureLayer === "CONTROLLER_CRASH" && i === backendNodes.length - 1;
        pushStep({
          nodeId: node.id,
          edgeId: edgeFromPrev,
          direction: "forward",
          phase: node.kind,
          status: crashHere ? "ERROR" : "PASS",
          statusCode: crashHere ? 500 : null,
          title: `${node.title}`,
          summary:
            node.kind === "INPUT"
              ? `Extracted ${node.subtitle} from incoming request.`
              : node.kind === "SERVICE"
                ? `Invoked service ${node.title}.`
                : `Executed ${node.title}: ${node.subtitle}.`,
          filePath: node.filePath || null,
          line: node.line || null,
          codeSnippet: node.snippet || "",
          branchEvaluation: null,
          dbOperation: null,
          responseState: null,
        });
        lastTraversedNodeId = node.id;
        if (crashHere) {
          stopReason = "CATCH_ERROR";
          triggeredNodeId = node.id;
          responseStatusCode = 500;
          break;
        }
      }
    }

    // If a non-2xx scenario had no explicit matching branch (e.g. generic error), route via catch/error if edge exists
    if (!stopReason && effectiveStatus >= 400) {
      responseStatusCode = effectiveStatus;
      if (effectiveStatus >= 500) stopReason = "CATCH_ERROR";
    }
  }

  // Step 4: Return to HTTP Response node (choose exact edge in shared graph!)
  let edgeToResponse = `e_${lastTraversedNodeId}_response_ok`;
  if (stopReason === "ROUTER_404") {
    edgeToResponse = "e_router_response_404";
  } else if (stopReason === "MW_REJECT") {
    edgeToResponse = `e_${lastTraversedNodeId}_response_reject`;
  } else if (stopReason === "DECISION_EARLY_RETURN") {
    edgeToResponse = `e_${triggeredNodeId}_response_true`;
  } else if (stopReason === "DB_ERROR" || stopReason === "CATCH_ERROR") {
    const catchEdge = edges.find(
      (e) => e.from === lastTraversedNodeId && e.id.endsWith("_response_catch"),
    );
    edgeToResponse = catchEdge ? catchEdge.id : `e_${lastTraversedNodeId}_response_ok`;
  } else if (stopReason === "CONTROLLER_ERROR") {
    edgeToResponse = "e_controller_response_guard";
  }

  // Ensure chosen edgeId exists in graph.edges
  if (!edges.some((e) => e.id === edgeToResponse)) {
    const fallbackEdge = edges.find(
      (e) => e.from === lastTraversedNodeId && e.to === "response",
    );
    edgeToResponse = fallbackEdge ? fallbackEdge.id : null;
  }

  const isErrorResponse = responseStatusCode >= 500;
  const isClientWarnResponse = responseStatusCode >= 400 && responseStatusCode < 500;

  pushStep({
    nodeId: "response",
    edgeId: edgeToResponse,
    direction: "return",
    phase: "RESPONSE",
    status: isErrorResponse ? "ERROR" : isClientWarnResponse ? "BLOCKED" : "PASS",
    statusCode: responseStatusCode,
    title: `HTTP ${responseStatusCode} Returned`,
    summary: `Server responded with HTTP ${responseStatusCode}${
      scenario.duration !== undefined && scenario.duration !== null
        ? ` in ${scenario.duration}ms`
        : ""
    }.`,
    filePath: responseNode?.filePath || null,
    line: responseNode?.line || null,
    codeSnippet: responseNode?.snippet || "",
    branchEvaluation: null,
    dbOperation: null,
    responseState: {
      statusCode: responseStatusCode,
      data: scenario.responseData || null,
    },
  });

  // Step 5: Test Assertion
  const finalPassed = isRecordedRun ? !isRecordedFail : true;

  pushStep({
    nodeId: "assertion",
    edgeId: "e_response_assertion",
    direction: "return",
    phase: "ASSERTION",
    status: finalPassed ? "PASS" : "ERROR",
    statusCode: responseStatusCode,
    title: finalPassed
      ? `Assertion Passed (${responseStatusCode})`
      : `Assertion Failed (Expected ${expectedStatus}, Got ${actualStatus || responseStatusCode})`,
    summary: finalPassed
      ? `Test assertions verified expected HTTP ${expectedStatus} contract (${categoryLabel}).`
      : scenario.failureSummary ||
        `Scenario failed at ${failureLayer || "ASSERTION_FAILED"}: expected ${expectedStatus}, received ${actualStatus || responseStatusCode}.`,
    filePath: scenario.filePath || scenario.testFile || null,
    line: null,
    codeSnippet: scenario.code || "",
    branchEvaluation: null,
    dbOperation: null,
    responseState: {
      expectedStatus,
      actualStatus: actualStatus || responseStatusCode,
      passed: finalPassed,
      failureLayer,
    },
  });

  const activeNodeIds = [...new Set(steps.map((s) => s.nodeId))];
  const activeEdgeIds = [...new Set(steps.map((s) => s.edgeId).filter(Boolean))];

  return {
    mode: isRecordedRun ? "RECORDED" : "AST_SIMULATED",
    endpointKey: sharedGraph.endpointKey,
    scenario: {
      id: scenario.scenarioId || scenario.id || null,
      title: scenario.title || scenario.testName || `${httpDetails.method} ${httpDetails.path}`,
      category: caseKey,
      categoryLabel,
      origin: scenario.origin || "AI_GENERATED",
      status: rawStatus || "READY",
      expectedStatus,
      actualStatus: actualStatus || responseStatusCode,
      failureLayer,
      durationMs: scenario.duration ?? scenario.durationMs ?? null,
    },
    graph: sharedGraph,
    steps,
    activeNodeIds,
    activeEdgeIds,
    outcome: {
      expectedStatus,
      actualStatus: actualStatus || responseStatusCode,
      passed: finalPassed,
      failureLayer,
      durationMs: scenario.duration ?? scenario.durationMs ?? null,
    },
  };
}

/**
 * Resolves snapshot workspace data (with strict Prisma select) and computes
 * an Integration Flow Simulation trace for the requested endpoint & scenario.
 * Consumes 0 AI tokens.
 */
export async function simulateIntegrationScenarioTrace(snapshotId, payload = {}) {
  if (!snapshotId) {
    throw new ServiceError("snapshotId is required", 400);
  }

  const snapshot =
    payload.snapshot ||
    (await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        rootDir: true,
        storagePath: true,
      },
    }));

  if (!snapshot) {
    throw new ServiceError("Snapshot not found", 404);
  }

  const sourceFiles = Array.isArray(payload.sourceFiles)
    ? payload.sourceFiles
    : await loadSourceCode(snapshotId, snapshot.rootDir || snapshot.storagePath).catch(
        (err) => {
          console.warn("[IntegrationSimulation] Failed to load sourceCode:", err.message);
          return [];
        },
      );

  let endpoint = payload.endpoint || null;
  const targetMethod = (payload.method || endpoint?.method || "GET").toUpperCase();
  const targetPath = payload.path || endpoint?.path || endpoint?.fullPath || "/";

  if (!endpoint || !endpoint.requestProcessingChain) {
    const discovered = extractValidEndpoints(sourceFiles);
    const matched = discovered.find(
      (ep) =>
        (ep.method || "GET").toUpperCase() === targetMethod &&
        doesRouteMatch(ep.path || ep.fullPath || "/", targetPath),
    );
    if (matched) {
      endpoint = {
        ...matched,
        ...(endpoint || {}),
        requestProcessingChain:
          endpoint?.requestProcessingChain || matched.requestProcessingChain,
        behaviorEvidence: endpoint?.behaviorEvidence || matched.behaviorEvidence,
        middlewares: endpoint?.middlewares || matched.middlewares,
        databaseModels: endpoint?.databaseModels || matched.databaseModels,
      };
    }
  }

  if (!endpoint) {
    endpoint = {
      method: targetMethod,
      path: targetPath,
    };
  }

  let scenario = payload.scenario || null;

  if (!scenario || (!scenario.actualStatus && !scenario.failureLayer)) {
    try {
      const latestRun = await prisma.testRun.findFirst({
        where: { snapshotId, type: { in: ["SUPERTEST", "PLAYWRIGHT_API"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestRun) {
        const scenarioTitle = scenario?.title || scenario?.testName || payload.testName;
        if (scenarioTitle) {
          const dbScenario = await prisma.testScenario.findFirst({
            where: {
              testRunId: latestRun.id,
              title: scenarioTitle,
            },
            select: {
              id: true,
              title: true,
              status: true,
              durationMs: true,
              failureLayer: true,
              responseStatus: true,
              responseData: true,
              failureMessages: true,
            },
          });
          if (dbScenario) {
            scenario = {
              ...(scenario || {}),
              title: scenario?.title || dbScenario.title,
              status: scenario?.status || dbScenario.status,
              duration: scenario?.duration ?? dbScenario.durationMs,
              failureLayer: scenario?.failureLayer || dbScenario.failureLayer,
              actualStatus: scenario?.actualStatus ?? dbScenario.responseStatus,
              responseData: scenario?.responseData ?? dbScenario.responseData,
              failureMessages: scenario?.failureMessages || dbScenario.failureMessages,
            };
          }
        }
      }
    } catch (err) {
      console.warn("[IntegrationSimulation] Failed to enrich recorded scenario:", err.message);
    }
  }

  if (!scenario) {
    scenario = {
      title: payload.testName || `${targetMethod} ${targetPath}`,
      method: targetMethod,
      path: targetPath,
      code: payload.code || "",
      expectedStatus: payload.expectedStatus || null,
    };
  }

  const graph = buildApiSimulationGraph({ endpoint, sourceFiles });
  return buildIntegrationScenarioTrace({
    endpoint,
    scenario,
    graph,
    sourceFiles,
  });
}
