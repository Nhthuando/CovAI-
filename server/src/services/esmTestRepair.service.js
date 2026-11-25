import fs from "fs";
import path from "path";
import traverseModule from "@babel/traverse";
import { parseJavaScriptCode } from "./babelParser.service.js";

const traverse = traverseModule.default || traverseModule;

const EXTENSION_CANDIDATES = ["", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", "/index.js", "/index.mjs"];

/**
 * Resolves a relative import/require/mock specifier from `testFilePath` against known project
 * `sourceCode` entries and on-disk files under `rootDir`, fixing wrong folder depth and missing `.js` extensions.
 *
 * @param {string} specifier
 * @param {string} testFilePath
 * @param {Array<{path: string, content?: string}>} [sourceCode]
 * @param {string|null} [rootDir]
 * @param {{ ensureExtension?: boolean }} [options]
 * @returns {string}
 */
export const resolveRelativeSpecifier = (
    specifier,
    testFilePath = "tests/unit.test.js",
    sourceCode = [],
    rootDir = null,
    options = {},
) => {
    if (!specifier || !specifier.startsWith(".")) return specifier;

    const ensureExt = options.ensureExtension !== false;
    const normTest = String(testFilePath || "tests/unit.test.js").replace(/\\/g, "/").replace(/^\/+/, "");
    const fromDir = path.posix.dirname(normTest);
    const sourceMap = new Map();
    for (const f of (sourceCode || [])) {
        if (!f?.path) continue;
        sourceMap.set(String(f.path).replace(/\\/g, "/").replace(/^\/+/, ""), f);
    }

    const existsAtRepoRel = (candidateRel) => {
        const clean = String(candidateRel || "").replace(/\\/g, "/").replace(/^\/+/, "");
        for (const ext of EXTENSION_CANDIDATES) {
            const withExt = `${clean}${ext}`;
            if (sourceMap.has(withExt)) return withExt;
            if (rootDir) {
                try {
                    const abs = path.resolve(rootDir, withExt);
                    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return withExt;
                } catch (_) {}
            }
        }
        return null;
    };

    const directTarget = path.posix.normalize(path.posix.join(fromDir, specifier));
    const directHit = existsAtRepoRel(directTarget);
    if (directHit) {
        if (!ensureExt && directHit === directTarget) return specifier;
        let rel = path.posix.relative(fromDir, directHit);
        if (!rel.startsWith(".")) rel = `./${rel}`;
        return rel;
    }

    // Attempt suffix recovery (e.g. "../../services/article.service.js" -> "server/src/services/article.service.js",
    // or "../../server/src/index.js" when test is already inside "server/tests/integration/api.test.js").
    const cleanSpecTail = specifier.replace(/^(?:\.\.?\/)+/, "").replace(/\.[cm]?[jt]sx?$/i, "");
    const backendPrefix = normTest.includes("/") && ["server", "backend", "api"].includes(normTest.split("/")[0])
        ? `${normTest.split("/")[0]}/`
        : "";

    const candidates = [...sourceMap.keys()];
    if (candidates.length > 0) {
        // Prefer matches in the same package subdir (e.g. "server/") first
        const ranked = candidates
            .filter((p) => {
                const noExt = p.replace(/\.[cm]?[jt]sx?$/i, "");
                return noExt === cleanSpecTail ||
                    noExt.endsWith(`/${cleanSpecTail}`) ||
                    noExt.endsWith(`/${path.posix.basename(cleanSpecTail)}`);
            })
            .sort((a, b) => {
                const aSamePkg = backendPrefix && a.startsWith(backendPrefix) ? 0 : 1;
                const bSamePkg = backendPrefix && b.startsWith(backendPrefix) ? 0 : 1;
                if (aSamePkg !== bSamePkg) return aSamePkg - bSamePkg;
                const aExactSuffix = a.replace(/\.[cm]?[jt]sx?$/i, "").endsWith(`/${cleanSpecTail}`) ? 0 : 1;
                const bExactSuffix = b.replace(/\.[cm]?[jt]sx?$/i, "").endsWith(`/${cleanSpecTail}`) ? 0 : 1;
                return aExactSuffix - bExactSuffix;
            });

        if (ranked.length > 0) {
            let rel = path.posix.relative(fromDir, ranked[0]);
            if (!rel.startsWith(".")) rel = `./${rel}`;
            return rel;
        }
    }

    if (rootDir) {
        const probeRoots = [
            cleanSpecTail,
            `src/${cleanSpecTail}`,
            ...(backendPrefix ? [`${backendPrefix}${cleanSpecTail}`, `${backendPrefix}src/${cleanSpecTail}`] : []),
        ];
        for (const probe of probeRoots) {
            const hit = existsAtRepoRel(probe);
            if (hit) {
                let rel = path.posix.relative(fromDir, hit);
                if (!rel.startsWith(".")) rel = `./${rel}`;
                return rel;
            }
        }
    }

    return specifier;
};

/**
 * Parses a source module to inspect default/named exports, top-level .listen() calls,
 * mounted Express routers, inline routes, and database/AI SDK usage.
 */
export const inspectModuleExportsAst = (content = "", filePath = "") => {
    const info = {
        hasDefaultExport: false,
        namedExports: new Set(),
        hasTopLevelListen: false,
        mountedUses: [],
        inlineHandlers: [],
        usesPrisma: /@prisma\/client|\/prisma(?:\.js)?['"]/.test(content),
        usesGoogleGenAi: /@google\/generative-ai/.test(content),
        usesMongoose: /['"]mongoose['"]/.test(content),
        usesSocketIo: /['"]socket\.io['"]/.test(content),
    };
    if (!content || typeof content !== "string") return info;

    const parsed = parseJavaScriptCode(content, { filePath, allowRecoveredAst: true });
    if (!parsed.success || !parsed.ast?.program?.body) {
        info.hasDefaultExport = /\bexport\s+default\b/.test(content);
        if (/\bexport\s+(?:const|let|var)\s+app\b|\bexport\s*\{[^}]*\bapp\b/.test(content)) {
            info.namedExports.add("app");
        }
        info.hasTopLevelListen = /\.listen\s*\(/.test(content);
        return info;
    }

    const importMap = new Map();
    for (const stmt of parsed.ast.program.body) {
        if (stmt.type === "ImportDeclaration") {
            const spec = stmt.source?.value;
            if (!spec) continue;
            for (const sp of stmt.specifiers || []) {
                importMap.set(sp.local?.name, {
                    source: spec,
                    imported: sp.type === "ImportDefaultSpecifier" ? "default" : (sp.imported?.name || sp.local?.name),
                });
            }
        } else if (stmt.type === "ExportDefaultDeclaration") {
            info.hasDefaultExport = true;
        } else if (stmt.type === "ExportNamedDeclaration") {
            if (stmt.declaration?.type === "VariableDeclaration") {
                for (const d of stmt.declaration.declarations || []) {
                    if (d.id?.name) info.namedExports.add(d.id.name);
                }
            } else if (stmt.declaration?.id?.name) {
                info.namedExports.add(stmt.declaration.id.name);
            }
            for (const sp of stmt.specifiers || []) {
                const name = sp.exported?.name || sp.exported?.value;
                if (name) info.namedExports.add(name);
            }
        } else if (stmt.type === "ExpressionStatement") {
            const expr = stmt.expression;
            if (expr?.type === "CallExpression" && expr.callee?.type === "MemberExpression") {
                const objName = expr.callee.object?.name;
                const propName = expr.callee.property?.name;
                if (propName === "listen") info.hasTopLevelListen = true;

                if (objName === "app" && propName === "use") {
                    const first = expr.arguments?.[0];
                    const second = expr.arguments?.[1];
                    const prefix = first?.type === "StringLiteral" ? first.value : null;
                    const arg = prefix ? second : first;
                    if (arg?.type === "Identifier" && importMap.has(arg.name)) {
                        const meta = importMap.get(arg.name);
                        if (meta.source.startsWith(".")) {
                            info.mountedUses.push({
                                varName: arg.name,
                                prefix,
                                source: meta.source,
                                imported: meta.imported,
                            });
                        }
                    }
                }

                if (objName === "app" && ["get", "post", "put", "patch", "delete"].includes(propName)) {
                    const routeArg = expr.arguments?.[0];
                    if (routeArg?.type === "StringLiteral" && expr.start != null && expr.end != null) {
                        info.inlineHandlers.push(content.slice(expr.start, expr.end) + ";");
                    }
                }
            }

            if (expr?.type === "AssignmentExpression" && expr.left?.type === "MemberExpression") {
                const leftObj = expr.left.object?.name;
                const leftProp = expr.left.property?.name;
                if (leftObj === "module" && leftProp === "exports") {
                    if (expr.right?.type === "Identifier") {
                        info.hasDefaultExport = true;
                    } else if (expr.right?.type === "ObjectExpression") {
                        for (const prop of expr.right.properties || []) {
                            const k = prop.key?.name || prop.key?.value;
                            if (k) info.namedExports.add(k);
                        }
                    }
                }
            }
        }
    }
    return info;
};

/**
 * Generates an ESM-compatible `jest.unstable_mockModule` block for Prisma that supports stateful
 * find/create/upsert queries, safe nested include defaults, and Jest mock overrides.
 */
export const buildEsmPrismaMockBlock = (relPrismaPaths = []) => {
    const uniquePaths = Array.from(new Set(relPrismaPaths.filter(Boolean)));
    const lines = [
        "// [CovAI ESM Prisma Mock] Intercepts Prisma before dynamic module imports",
        "const _covaiCreatePrismaStub = () => {",
        "  const _stores = new Map();",
        "  const _proxies = new Map();",
        "  const _makeModel = (name) => {",
        "    if (_proxies.has(name)) return _proxies.get(name);",
        "    if (!_stores.has(name)) _stores.set(name, []);",
        "    const _getRows = () => _stores.get(name);",
        "    const _withIncludes = (row, params) => {",
        "      if (!row || typeof row !== 'object' || !params?.include) return row;",
        "      const out = { ...row };",
        "      for (const [k, v] of Object.entries(params.include)) {",
        "        if (v && out[k] === undefined) {",
        "          out[k] = k.endsWith('s') ? [] : { id: 1, url: 'https://example.com', domain: 'example.com', title: 'Sample' };",
        "        }",
        "      }",
        "      return out;",
        "    };",
        "    const model = {",
        "      findMany: jest.fn(async (p = {}) => _getRows().map((r) => _withIncludes(r, p))),",
        "      findFirst: jest.fn(async (p = {}) => {",
        "        const rows = _getRows();",
        "        return rows.length ? _withIncludes(rows[0], p) : null;",
        "      }),",
        "      findUnique: jest.fn(async () => null),",
        "      findUniqueOrThrow: jest.fn(async () => ({ id: 1 })),",
        "      findFirstOrThrow: jest.fn(async () => ({ id: 1 })),",
        "      create: jest.fn(async (p = {}) => {",
        "        const rows = _getRows();",
        "        const rec = { id: p?.data?.id ?? rows.length + 1, createdAt: new Date(), ...(p?.data || {}) };",
        "        rows.push(rec);",
        "        return _withIncludes(rec, p);",
        "      }),",
        "      createMany: jest.fn(async (p = {}) => ({ count: Array.isArray(p?.data) ? p.data.length : 1 })),",
        "      upsert: jest.fn(async (p = {}) => {",
        "        const rows = _getRows();",
        "        const rec = { id: rows.length + 1, ...(p?.create || p?.update || {}) };",
        "        rows.push(rec);",
        "        return _withIncludes(rec, p);",
        "      }),",
        "      update: jest.fn(async (p = {}) => ({ id: p?.where?.id ?? 1, ...(p?.data || {}) })),",
        "      updateMany: jest.fn(async () => ({ count: 1 })),",
        "      delete: jest.fn(async (p = {}) => ({ id: p?.where?.id ?? 1 })),",
        "      deleteMany: jest.fn(async () => ({ count: 0 })),",
        "      count: jest.fn(async () => _getRows().length),",
        "      aggregate: jest.fn(async () => ({ _count: 0, _sum: {}, _avg: {}, _min: {}, _max: {} })),",
        "      groupBy: jest.fn(async () => []),",
        "    };",
        "    const modelProxy = new Proxy(model, {",
        "      get(target, prop) {",
        "        if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') return undefined;",
        "        if (!(prop in target)) target[prop] = jest.fn(async () => null);",
        "        return target[prop];",
        "      },",
        "    });",
        "    _proxies.set(name, modelProxy);",
        "    return modelProxy;",
        "  };",
        "  return new Proxy({",
        "    $connect: jest.fn(async () => undefined),",
        "    $disconnect: jest.fn(async () => undefined),",
        "    $transaction: jest.fn(async (arg) => (typeof arg === 'function' ? arg(_covaiSharedPrisma) : Promise.all(arg || []))),",
        "    $queryRaw: jest.fn(async () => []),",
        "    $executeRaw: jest.fn(async () => 0),",
        "    $extends: jest.fn(function () { return this; }),",
        "  }, {",
        "    get(target, prop) {",
        "      if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') return undefined;",
        "      if (prop in target) return target[prop];",
        "      return _makeModel(String(prop));",
        "    },",
        "  });",
        "};",
        "const _covaiSharedPrisma = _covaiCreatePrismaStub();",
        "const _CovaiPrismaClient = jest.fn(function () {",
        "  if (this && typeof this === 'object') {",
        "    return new Proxy(this, {",
        "      get(target, prop) {",
        "        if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') return undefined;",
        "        const val = _covaiSharedPrisma[prop];",
        "        return val !== undefined ? val : target[prop];",
        "      },",
        "    });",
        "  }",
        "  return _covaiSharedPrisma;",
        "});",
        "await jest.unstable_mockModule('@prisma/client', () => ({",
        "  __esModule: true,",
        "  PrismaClient: _CovaiPrismaClient,",
        "  default: { PrismaClient: _CovaiPrismaClient },",
        "  Prisma: {",
        "    PrismaClientKnownRequestError: class extends Error { constructor(m, o) { super(m); this.code = o?.code || 'P2000'; } },",
        "    PrismaClientValidationError: class extends Error {},",
        "    Decimal: Number,",
        "  },",
        "}));",
    ];

    for (const relPath of uniquePaths) {
        lines.push(`await jest.unstable_mockModule(${JSON.stringify(relPath)}, () => ({ __esModule: true, default: _covaiSharedPrisma, prisma: _covaiSharedPrisma }));`);
    }

    return lines.join("\n");
};

export const buildEsmGoogleGenAiMockBlock = () => [
    "process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'covai_test_gemini_key';",
    "await jest.unstable_mockModule('@google/generative-ai', () => ({",
    "  __esModule: true,",
    "  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({",
    "    getGenerativeModel: jest.fn(() => ({",
    "      generateContent: jest.fn(async () => ({",
    "        response: {",
    "          text: () => JSON.stringify({",
    "            summary: 'First summary sentence. Second summary sentence. Third summary sentence.',",
    "            topics: ['Technology', 'News'],",
    "            category: 'Technology',",
    "            confidence: 0.95,",
    "          }),",
    "        },",
    "      })),",
    "    })),",
    "  })),",
    "}));",
].join("\n");

/**
 * Checks if any source file imported (directly or 1-hop) by `sourceFile` uses Prisma or `@google/generative-ai`.
 */
export const detectProjectCapabilities = (sourceCode = [], rootDir = null, targetSourceFile = null) => {
    const map = new Map();
    for (const f of (sourceCode || [])) {
        if (f?.path) map.set(String(f.path).replace(/\\/g, "/").replace(/^\/+/, ""), f.content || "");
    }

    const prismaFiles = [];
    let usesPrisma = false;
    let usesGoogleGenAi = false;

    for (const [p, content] of map.entries()) {
        if (/\/(?:config|lib|db)\/prisma\.[cm]?[jt]s$/i.test(p)) {
            prismaFiles.push(p);
        }
        if (/@prisma\/client|prisma\.(?:[a-zA-Z_$][\w$]*)\.(?:find|create|update|delete|upsert|count)|\$transaction|\$connect/.test(content)) {
            usesPrisma = true;
        }
        if (/@google\/generative-ai/.test(content)) {
            usesGoogleGenAi = true;
        }
    }

    // Fallback disk probe when sourceCode only passed the single target file (Unit Test path)
    if (rootDir && targetSourceFile) {
        const normSrc = String(targetSourceFile).replace(/\\/g, "/").replace(/^\/+/, "");
        const pkgSub = ["server", "backend", "api"].includes(normSrc.split("/")[0]) ? normSrc.split("/")[0] : "";
        const prismaCandidates = [
            ...(pkgSub ? [`${pkgSub}/src/config/prisma.js`, `${pkgSub}/src/lib/prisma.js`, `${pkgSub}/config/prisma.js`, `${pkgSub}/lib/prisma.js`] : []),
            "src/config/prisma.js", "src/lib/prisma.js", "config/prisma.js", "lib/prisma.js",
        ];
        for (const cand of prismaCandidates) {
            try {
                const abs = path.resolve(rootDir, cand);
                if (fs.existsSync(abs) && fs.statSync(abs).isFile() && !prismaFiles.includes(cand)) {
                    prismaFiles.push(cand);
                }
            } catch (_) {}
        }

        // Follow relative imports 1-2 hops from targetSourceFile on disk to detect transitive prisma/@google/generative-ai usage
        const visited = new Set();
        const queue = [normSrc];
        while (queue.length > 0 && visited.size < 12) {
            const cur = queue.shift();
            if (!cur || visited.has(cur)) continue;
            visited.add(cur);
            let txt = map.get(cur);
            if (txt == null) {
                try {
                    const abs = path.resolve(rootDir, cur);
                    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) txt = fs.readFileSync(abs, "utf8");
                } catch (_) {}
            }
            if (!txt) continue;
            if (/@prisma\/client|prisma\.(?:\$|\w+\.)/.test(txt)) usesPrisma = true;
            if (/@google\/generative-ai/.test(txt)) usesGoogleGenAi = true;

            const importRe = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]\s*\)?/g;
            let m;
            while ((m = importRe.exec(txt)) !== null) {
                const resolved = resolveRelativeSpecifier(m[1], cur, sourceCode, rootDir);
                const repoRel = path.posix.normalize(path.posix.join(path.posix.dirname(cur), resolved));
                if (!visited.has(repoRel)) queue.push(repoRel);
            }
        }
    }

    return { prismaFiles, usesPrisma, usesGoogleGenAi };
};

const buildImportReplacement = (stmt, resolvedSpec, code) => {
    const specs = stmt.specifiers || [];
    if (specs.length === 0) {
        return `await import(${JSON.stringify(resolvedSpec)});`;
    }
    const defaultSpec = specs.find((s) => s.type === "ImportDefaultSpecifier");
    const nsSpec = specs.find((s) => s.type === "ImportNamespaceSpecifier");
    const namedSpecs = specs.filter((s) => s.type === "ImportSpecifier");

    if (nsSpec) {
        return `const ${nsSpec.local.name} = await import(${JSON.stringify(resolvedSpec)});`;
    }

    const parts = [];
    if (defaultSpec) parts.push(`default: ${defaultSpec.local.name}`);
    for (const s of namedSpecs) {
        const imp = s.imported?.name || s.imported?.value;
        const loc = s.local?.name;
        parts.push(imp === loc ? imp : `${imp}: ${loc}`);
    }
    return `const { ${parts.join(", ")} } = await import(${JSON.stringify(resolvedSpec)});`;
};

const isJestFrameworkImport = (spec) => spec === "@jest/globals" || spec === "supertest" || spec === "express" || spec === "vitest";

/**
 * Rewrites `jest.mock(mod, factory[, opts])` -> `await jest.unstable_mockModule(mod, factory)`
 * and converts local/mocked static `import` statements to dynamic `await import(...)` placed
 * AFTER all mock declarations (preventing ESM import hoisting from bypassing mocks).
 */
export const convertJestMocksAndStaticImportsToEsm = (code, { testFilePath = "tests/unit.test.js", sourceCode = [], rootDir = null, targetSourceFile = null, forcePrismaMock = false, forceGenAiMock = false } = {}) => {
    if (!code || typeof code !== "string") return code;
    if (rootDir && testFilePath && path.isAbsolute(testFilePath)) {
        testFilePath = path.relative(rootDir, testFilePath).replace(/\\/g, "/");
    }

    // Step 0: Strip any legacy CommonJS Universal Prisma Mock block (which loops `for (const _rp of _sanitizerRelPrismaPaths)`)
    let out = code
        .replace(/\/\/\s*Universal Prisma Mock to prevent database connection attempts during tests[\s\S]*?for\s*\(\s*const\s+_rp\s+of\s+_sanitizerRelPrismaPaths\s*\)\s*\{[\s\S]*?\}\s*(?:catch\s*\([^)]*\)\s*\{\s*\}\s*)?\}\s*\r?\n?/g, "")
        .replace(/const\s+_sanitizerRelPrismaPaths\s*=\s*\[[\s\S]*?\];\s*\r?\n?for\s*\(\s*const\s+_rp\s+of\s+_sanitizerRelPrismaPaths\s*\)\s*\{[\s\S]*?\}\s*\r?\n?/g, "");

    // Step 1: Resolve relative import/mock specifiers, strip `{ virtual: true }`, and drop unresolvable
    // path-alias or non-existent relative mocks (e.g. `@/lib/prisma`) because Jest ESM unstable_mockModule
    // cannot virtual-mock modules that do not exist on disk.
    out = out.replace(/\bjest\.mock\s*\(/g, "jest.unstable_mockModule(");

    const hasExplicitAliasMapper = (aliasPrefix) => {
        if (!rootDir) return false;
        const cleanPrefix = aliasPrefix.replace(/[^@~]/g, "");
        const pkgSub = String(testFilePath || "").includes("/") ? String(testFilePath).split("/")[0] : "";
        const cfgDirs = [...new Set([pkgSub ? path.join(rootDir, pkgSub) : null, rootDir].filter(Boolean))];
        for (const dir of cfgDirs) {
            for (const cfgName of ["jest.config.js", "jest.config.mjs", "jest.config.cjs", "jest.config.ts", "jest.config.json"]) {
                const cfgPath = path.join(dir, cfgName);
                if (fs.existsSync(cfgPath)) {
                    try {
                        const txt = fs.readFileSync(cfgPath, "utf8");
                        if (txt.includes("moduleNameMapper") && txt.includes(cleanPrefix)) return true;
                    } catch {}
                }
            }
            const pkgPath = path.join(dir, "package.json");
            if (fs.existsSync(pkgPath)) {
                try {
                    const txt = fs.readFileSync(pkgPath, "utf8");
                    if (txt.includes("moduleNameMapper") && txt.includes(cleanPrefix)) return true;
                } catch {}
            }
        }
        return false;
    };

    const testFileBase = path.posix.basename(String(testFilePath || "").replace(/\\/g, "/"))
        .replace(/(?:\.(?:partial|redundant|coverage|vitest|jest|unit))*\.(?:test|spec|steps?)\.[cm]?[jt]sx?$/i, "")
        .toLowerCase();

    const sourceTextForPkgCheck = Array.isArray(sourceCode)
        ? sourceCode.map((f) => String(f?.content || "")).join("\n")
        : String(sourceCode || "");
    const isPackageReferencedInSource = (spec) => {
        if (!spec || spec.startsWith(".")) return false;
        const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const refRe = new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${escaped}(?:/[^'"]*)?['"]`);
        if (refRe.test(sourceTextForPkgCheck)) return true;
        if (rootDir && targetSourceFile) {
            try {
                const absSrc = path.resolve(rootDir, targetSourceFile);
                if (fs.existsSync(absSrc) && fs.statSync(absSrc).isFile()) {
                    const diskSrc = fs.readFileSync(absSrc, "utf8");
                    if (refRe.test(diskSrc)) return true;
                }
            } catch (_) {}
        }
        return false;
    };

    const isUnresolvableEsmMockSpecifier = (specVal) => {
        if (!specVal || typeof specVal !== "string") return false;
        const normSutNoExt = String(targetSourceFile || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.[cm]?[jt]sx?$/i, "").toLowerCase();
        if (specVal.startsWith(".")) {
            const resolved = resolveRelativeSpecifier(specVal, testFilePath, sourceCode, rootDir);
            const fromDir = path.posix.dirname(String(testFilePath || "tests/unit.test.js").replace(/\\/g, "/").replace(/^\/+/, ""));
            const targetRel = path.posix.normalize(path.posix.join(fromDir, resolved));
            const targetNoExt = targetRel.replace(/\.[cm]?[jt]sx?$/i, "").toLowerCase();
            if (normSutNoExt && targetNoExt === normSutNoExt) return true;
            // Also guard against self-mocking when targetSourceFile wasn't explicitly passed (e.g. prisma.coverage.test.js mocking ../../src/config/prisma.js)
            const targetBase = path.posix.basename(targetNoExt);
            if (!normSutNoExt && testFileBase && targetBase === testFileBase && new RegExp(`import\\s*\\(\\s*['"]${resolved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`).test(out)) {
                return true;
            }
            if (!rootDir) return false;
            return !EXTENSION_CANDIDATES.some((ext) => {
                const candidate = ext ? `${targetNoExt}${ext}` : targetRel;
                try {
                    const abs = path.resolve(rootDir, candidate);
                    return fs.existsSync(abs) && fs.statSync(abs).isFile();
                } catch {
                    return false;
                }
            });
        }
        if (/^[@~]{1,2}\//.test(specVal)) {
            const aliasPrefix = specVal.match(/^([@~]{1,2}\/)/)?.[1] || "@/";
            if (!hasExplicitAliasMapper(aliasPrefix)) return true;
            return false;
        }
        // Check bare npm package specifiers: Jest ESM throws ERR_MODULE_NOT_FOUND when
        // calling jest.unstable_mockModule(pkg, ...) if the package is not installed on disk
        // (unlike CJS virtual mocks). If rootDir is known and the package cannot be resolved
        // in pkgSub, rootDir, or CovAI's runtime node_modules (and isn't a Node builtin),
        // drop unresolvable virtual mocks so the suite does not crash before running.
        if (rootDir && !specVal.startsWith("node:") && !specVal.startsWith("@jest/")) {
            const pkgName = specVal.startsWith("@")
                ? specVal.split("/").slice(0, 2).join("/")
                : specVal.split("/")[0];
            const pkgSub = String(testFilePath || "").includes("/") ? String(testFilePath).split("/")[0] : "";
            const searchRoots = [
                pkgSub ? path.join(rootDir, pkgSub) : null,
                rootDir,
                process.cwd(),
            ].filter(Boolean);
            const existsInNodeModules = searchRoots.some((baseDir) => {
                try {
                    return fs.existsSync(path.join(baseDir, "node_modules", pkgName));
                } catch {
                    return false;
                }
            });
            if (!existsInNodeModules && !isPackageReferencedInSource(specVal)) {
                return true;
            }
        }
        return false;
    };

    // Strip trailing `{ virtual: true }` 3rd arg from jest.unstable_mockModule(a, b, { virtual: true })
    // and wrap converted relative module factories so `default` export is always populated in native ESM.
    const parsed0 = parseJavaScriptCode(out, { filePath: testFilePath });
    if (parsed0.success) {
        const edits0 = [];
        traverse(parsed0.ast, {
            CallExpression(callPath) {
                const { node } = callPath;
                if (
                    node.callee?.type === "MemberExpression" &&
                    node.callee.object?.name === "jest" &&
                    node.callee.property?.name === "unstable_mockModule"
                ) {
                    const arg0 = node.arguments[0];
                    const arg1 = node.arguments[1];
                    const specVal = arg0?.type === "StringLiteral" ? arg0.value : "";
                    if (isUnresolvableEsmMockSpecifier(specVal)) {
                        const stmtNode = callPath.parent?.type === "AwaitExpression"
                            ? callPath.parentPath?.parent
                            : callPath.parent;
                        if (stmtNode?.type === "ExpressionStatement" && stmtNode.start != null && stmtNode.end != null) {
                            let rmEnd = stmtNode.end;
                            if (out[rmEnd] === "\r") rmEnd++;
                            if (out[rmEnd] === "\n") rmEnd++;
                            edits0.push({ start: stmtNode.start, end: rmEnd, text: "" });
                            return;
                        }
                    }
                    if (node.arguments.length >= 3 && node.arguments[2].type === "ObjectExpression") {
                        const prevArg = node.arguments[1];
                        edits0.push({ start: prevArg.end, end: node.arguments[2].end, text: "" });
                    }
                    if (arg0?.type === "StringLiteral" && specVal.startsWith(".")) {
                        const resolved = resolveRelativeSpecifier(specVal, testFilePath, sourceCode, rootDir);
                        if (resolved !== specVal) {
                            edits0.push({ start: arg0.start, end: arg0.end, text: JSON.stringify(resolved) });
                        }
                    }
                    if (arg1 && (arg1.type === "ArrowFunctionExpression" || arg1.type === "FunctionExpression")) {
                        const factorySrc = out.slice(arg1.start, arg1.end);
                        if (!factorySrc.includes("__covaiEsmMockNorm")) {
                            const wrapped = `async () => { const __covaiEsmMockNorm = await (${factorySrc})(); if (__covaiEsmMockNorm && (typeof __covaiEsmMockNorm === 'object' || typeof __covaiEsmMockNorm === 'function')) { const __covaiHasEnumDefault = Object.keys(__covaiEsmMockNorm).includes('default') && __covaiEsmMockNorm.default !== undefined; if (!__covaiHasEnumDefault) { try { return { ...__covaiEsmMockNorm, default: (__covaiEsmMockNorm.default !== undefined ? __covaiEsmMockNorm.default : __covaiEsmMockNorm) }; } catch (_) { return { default: (__covaiEsmMockNorm.default !== undefined ? __covaiEsmMockNorm.default : __covaiEsmMockNorm) }; } } if (__covaiEsmMockNorm.default && (typeof __covaiEsmMockNorm.default === 'object' || typeof __covaiEsmMockNorm.default === 'function')) { for (const [k, v] of Object.entries(__covaiEsmMockNorm)) { if (k !== 'default' && k !== '__esModule' && !(k in __covaiEsmMockNorm.default)) { try { __covaiEsmMockNorm.default[k] = v; } catch (_) {} } } } } return __covaiEsmMockNorm; }`;
                            edits0.push({ start: arg1.start, end: arg1.end, text: wrapped });
                        }
                    }
                }
            },
            ImportDeclaration({ node }) {
                if (node.source?.type === "StringLiteral" && node.source.value.startsWith(".")) {
                    const resolved = resolveRelativeSpecifier(node.source.value, testFilePath, sourceCode, rootDir);
                    if (resolved !== node.source.value) {
                        edits0.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(resolved) });
                    }
                }
            },
            ImportExpression({ node }) {
                if (node.source?.type === "StringLiteral" && node.source.value.startsWith(".")) {
                    const resolved = resolveRelativeSpecifier(node.source.value, testFilePath, sourceCode, rootDir);
                    if (resolved !== node.source.value) {
                        edits0.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(resolved) });
                    }
                }
            },
        });
        for (const e of edits0.sort((a, b) => b.start - a.start)) {
            out = out.slice(0, e.start) + e.text + out.slice(e.end);
        }
    } else {
        // Fallback when AST parse of rest of file temporarily fails: strip unresolvable path-alias mocks
        for (const m of [...out.matchAll(/(?:await\s+)?jest\.unstable_mockModule\s*\(\s*(['"])([^'"]+)\1/g)]) {
            const specVal = m[2];
            if (!isUnresolvableEsmMockSpecifier(specVal)) continue;
            const startIdx = m.index;
            const parenStart = out.indexOf("(", startIdx);
            if (parenStart === -1) continue;
            let depth = 1, i = parenStart + 1, inStr = null, esc = false;
            while (i < out.length && depth > 0) {
                const ch = out[i];
                if (inStr) {
                    if (esc) esc = false;
                    else if (ch === "\\") esc = true;
                    else if (ch === inStr) inStr = null;
                } else {
                    if (ch === "'" || ch === '"' || ch === "`") inStr = ch;
                    else if (ch === "(") depth++;
                    else if (ch === ")") depth--;
                }
                i++;
            }
            while (i < out.length && (out[i] === ";" || out[i] === " " || out[i] === "\t")) i++;
            if (out[i] === "\r") i++;
            if (out[i] === "\n") i++;
            out = out.slice(0, startIdx) + out.slice(i);
        }
    }

    // Ensure every `jest.unstable_mockModule(...)` at top-level has `await ` prefix
    out = out.replace(/^([ \t]*)(?!await\s+)jest\.unstable_mockModule\s*\(/gm, "$1await jest.unstable_mockModule(");

    // Fix TDZ & ordering: Parse AST statements at top-level.
    // Separate: (1) framework static imports (@jest/globals, supertest, express),
    //           (2) mock-helper variables (mock* / mServer / mSocket / _*) declared AFTER an unstable_mockModule that references them,
    //           (3) await jest.unstable_mockModule calls,
    //           (4) mocked-module or relative local static `import`s -> convert to `await import(...)` AFTER all mocks,
    //           (5) rest of body (describe / test / helpers).
    const parsed1 = parseJavaScriptCode(out, { filePath: testFilePath });
    if (!parsed1.success || !parsed1.ast?.program?.body) return out;

    const body = parsed1.ast.program.body;
    const mockedSpecifiers = new Set();
    for (const stmt of body) {
        const checkCall = (node) => {
            if (!node || typeof node !== "object") return;
            if (node.type === "CallExpression" && node.callee?.object?.name === "jest" && node.callee?.property?.name === "unstable_mockModule") {
                const s = node.arguments?.[0]?.value;
                if (typeof s === "string") mockedSpecifiers.add(s);
            }
            for (const v of Object.values(node)) {
                if (Array.isArray(v)) v.forEach(checkCall);
                else if (v && typeof v === "object" && v.type) checkCall(v);
            }
        };
        checkCall(stmt);
    }

    // Also collect identifiers referenced inside unstable_mockModule calls (and transitively inside
    // any helper declarations they depend on, e.g. mockCreateUniversalStub -> _createStubMaker)
    // so we can hoist all required declarations before unstable_mockModule calls.
    const mockReferencedIds = new Set();
    const topLevelDeclRefs = new Map();
    for (const stmt of body) {
        const stmtSrc = out.slice(stmt.start, stmt.end);
        if (stmtSrc.includes("jest.unstable_mockModule")) {
            const idMatches = stmtSrc.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g);
            for (const m of idMatches) mockReferencedIds.add(m[1]);
        }
        if (stmt.type === "VariableDeclaration" || stmt.type === "FunctionDeclaration") {
            const declaredNames = stmt.type === "FunctionDeclaration"
                ? [stmt.id?.name].filter(Boolean)
                : (stmt.declarations || []).map((d) => d.id?.name).filter(Boolean);
            const refs = new Set();
            for (const m of stmtSrc.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g)) {
                refs.add(m[1]);
            }
            for (const dn of declaredNames) {
                if (!topLevelDeclRefs.has(dn)) topLevelDeclRefs.set(dn, new Set());
                for (const r of refs) topLevelDeclRefs.get(dn).add(r);
            }
        }
    }
    let addedTransitive = true;
    while (addedTransitive) {
        addedTransitive = false;
        for (const [declName, refs] of topLevelDeclRefs.entries()) {
            if (!mockReferencedIds.has(declName)) continue;
            for (const r of refs) {
                if (!mockReferencedIds.has(r)) {
                    mockReferencedIds.add(r);
                    addedTransitive = true;
                }
            }
        }
    }

    const frameworkImports = [];
    const hoistedMockVars = [];
    const unstableMockStmts = [];
    const deferredDynamicImports = [];
    const remainingStmts = [];
    let hasGlobalsImport = false;
    let needsJest = /\bjest\./.test(out);
    let seenSuiteBlock = false;

    for (const stmt of body) {
        const rawStmt = out.slice(stmt.start, stmt.end).trim();
        if (stmt.type === "ImportDeclaration") {
            const spec = stmt.source?.value || "";
            if (spec === "@jest/globals") {
                hasGlobalsImport = true;
                frameworkImports.push(rawStmt);
                continue;
            }
            if (isJestFrameworkImport(spec) && !mockedSpecifiers.has(spec)) {
                frameworkImports.push(rawStmt);
                continue;
            }
            // Any relative import or mocked module must be loaded via dynamic await import() AFTER unstable_mockModule!
            if (spec.startsWith(".") || mockedSpecifiers.has(spec) || mockedSpecifiers.size > 0 || forcePrismaMock || forceGenAiMock) {
                deferredDynamicImports.push(buildImportReplacement(stmt, spec, out));
                continue;
            }
            frameworkImports.push(rawStmt);
            continue;
        }

        // Only hoist direct top-level jest.unstable_mockModule expression statements (never nested control flow)
        if (
            stmt.type === "ExpressionStatement" &&
            stmt.expression?.type === "AwaitExpression" &&
            stmt.expression.argument?.type === "CallExpression" &&
            stmt.expression.argument.callee?.object?.name === "jest" &&
            stmt.expression.argument.callee?.property?.name === "unstable_mockModule"
        ) {
            unstableMockStmts.push(rawStmt);
            continue;
        }
        if (
            stmt.type === "ExpressionStatement" &&
            stmt.expression?.type === "CallExpression" &&
            stmt.expression.callee?.object?.name === "jest" &&
            stmt.expression.callee?.property?.name === "unstable_mockModule"
        ) {
            unstableMockStmts.push(rawStmt);
            continue;
        }

        // Keep top-level helper variables and function declarations declared before describe/test blocks
        // (or referenced inside any hoisted unstable_mockModule call) ahead of unstable_mockModule calls to avoid TDZ errors.
        if (stmt.type === "VariableDeclaration" || stmt.type === "FunctionDeclaration") {
            const declaredNames = stmt.type === "FunctionDeclaration"
                ? [stmt.id?.name].filter(Boolean)
                : (stmt.declarations || []).map((d) => d.id?.name).filter(Boolean);
            const isReferencedByMock = declaredNames.some((n) => mockReferencedIds.has(n));
            if (!seenSuiteBlock || isReferencedByMock) {
                const hasRequire = /\brequire\s*\(/.test(rawStmt);
                const hasDynamicImport = /\bawait\s+import\b/.test(rawStmt);
                if (!hasRequire && !hasDynamicImport) {
                    hoistedMockVars.push(rawStmt);
                    continue;
                }
            }
        }

        if (/^(?:describe|test|it|beforeEach|afterEach|beforeAll|afterAll)\b/.test(rawStmt)) {
            seenSuiteBlock = true;
        }

        remainingStmts.push(rawStmt);
    }

    // Auto-inject Prisma / GoogleGenAI ESM mocks if target project uses them and they are not yet mocked
    const caps = detectProjectCapabilities(sourceCode, rootDir, targetSourceFile);
    const alreadyMocksPrismaPkg = mockedSpecifiers.has("@prisma/client") || out.includes("_covaiSharedPrisma");
    const alreadyMocksRelPrisma = [...mockedSpecifiers].some((s) => /prisma(?:\.js)?$/i.test(s));
    const injectedMocks = [];

    if ((forcePrismaMock || caps.usesPrisma) && !alreadyMocksPrismaPkg && !alreadyMocksRelPrisma) {
        const testDir = path.posix.dirname(String(testFilePath).replace(/\\/g, "/"));
        const normSut = String(targetSourceFile || "").replace(/\\/g, "/").replace(/^\/+/, "");
        const relPrismaPaths = caps.prismaFiles
            .filter((pf) => pf !== normSut)
            .map((pf) => {
                let rel = path.posix.relative(testDir, pf);
                if (!rel.startsWith(".")) rel = `./${rel}`;
                return rel;
            });
        injectedMocks.push(buildEsmPrismaMockBlock(relPrismaPaths));
        needsJest = true;
    }

    if ((forceGenAiMock || caps.usesGoogleGenAi) && !mockedSpecifiers.has("@google/generative-ai") && ![...mockedSpecifiers].some((s) => /ai\.service/i.test(s))) {
        injectedMocks.push(buildEsmGoogleGenAiMockBlock());
        needsJest = true;
    }

    if (!hasGlobalsImport && needsJest) {
        frameworkImports.unshift("import { jest, describe, it, test, expect, beforeEach, afterEach } from '@jest/globals';");
    }

    const sections = [
        frameworkImports.join("\n"),
        hoistedMockVars.join("\n"),
        injectedMocks.join("\n"),
        unstableMockStmts.join("\n"),
        deferredDynamicImports.join("\n"),
        remainingStmts.join("\n\n"),
    ].filter((s) => s && s.trim().length > 0);

    let result = sections.join("\n\n") + "\n";

    // Declare `let req, res, next;` at describe scope when beforeEach assigns them without a direct declaration
    const astAfter = parseJavaScriptCode(result, { filePath: testFilePath });
    if (astAfter.success && astAfter.ast?.program?.body) {
        const topDeclared = new Set();
        for (const st of astAfter.ast.program.body) {
            if (st.type === "VariableDeclaration") {
                for (const d of st.declarations || []) {
                    if (d.id?.name) topDeclared.add(d.id.name);
                }
            }
        }
        const descInsertions = [];
        traverse(astAfter.ast, {
            CallExpression(dPath) {
                if (dPath.node.callee?.name !== "describe") return;
                const dBody = dPath.node.arguments?.[1]?.body;
                if (!dBody || dBody.type !== "BlockStatement") return;
                const directDecls = new Set(topDeclared);
                const assigned = new Set();
                for (const st of dBody.body || []) {
                    if (st.type === "VariableDeclaration") {
                        for (const d of st.declarations || []) {
                            if (d.id?.name) directDecls.add(d.id.name);
                        }
                    } else if (
                        st.type === "ExpressionStatement" &&
                        st.expression?.type === "CallExpression" &&
                        st.expression.callee?.name === "beforeEach"
                    ) {
                        const beFn = st.expression.arguments?.[0]?.body;
                        if (beFn?.type === "BlockStatement") {
                            for (const beStmt of beFn.body || []) {
                                if (
                                    beStmt.type === "ExpressionStatement" &&
                                    beStmt.expression?.type === "AssignmentExpression" &&
                                    beStmt.expression.left?.type === "Identifier" &&
                                    ["req", "res", "next"].includes(beStmt.expression.left.name)
                                ) {
                                    assigned.add(beStmt.expression.left.name);
                                }
                            }
                        }
                    }
                }
                const missing = ["req", "res", "next"].filter((v) => assigned.has(v) && !directDecls.has(v));
                if (missing.length > 0) {
                    descInsertions.push({ pos: dBody.start + 1, text: `\n  let ${missing.join(", ")};` });
                }
            },
        });
        if (descInsertions.length > 0) {
            descInsertions.sort((a, b) => b.pos - a.pos);
            for (const ins of descInsertions) {
                result = result.slice(0, ins.pos) + ins.text + result.slice(ins.pos);
            }
        }
    } else {
        const undeclared = [];
        for (const v of ["req", "res", "next"]) {
            const assigns = new RegExp(`(?:^|\\n)\\s*${v}\\s*=\\s*`, "m").test(result);
            const declares = new RegExp(`(?:^|\\n)\\s*(?:let|var|const)\\s+[^;\\n]*\\b${v}\\b`, "m").test(result);
            if (assigns && !declares) undeclared.push(v);
        }
        if (undeclared.length > 0) {
            result = result.replace(/(describe\s*\([^{]*\{\s*\r?\n)/, `$1  let ${undeclared.join(", ")};\n`);
        }
    }

    return result;
};

/**
 * Normalizes a Supertest integration test file's app import & composition when the target entry file
 * either uses named `{ app }` export or does NOT export `app` (like `server/src/index.js` exporting `{ io }`).
 */
export const repairSupertestAppImport = (code, { testFilePath, moduleType = "esm", sourceCode = [], rootDir = null } = {}) => {
    if (!code || typeof code !== "string") return code;

    const sourceMap = new Map();
    for (const f of (sourceCode || [])) {
        if (f?.path) sourceMap.set(String(f.path).replace(/\\/g, "/").replace(/^\/+/, ""), f.content || "");
    }

    const fromDir = path.posix.dirname(String(testFilePath || "tests/integration/api.test.js").replace(/\\/g, "/"));
    const resolveRepoFile = (spec) => {
        if (!spec || !spec.startsWith(".")) return null;
        const fixedSpec = resolveRelativeSpecifier(spec, testFilePath, sourceCode, rootDir);
        const repoRel = path.posix.normalize(path.posix.join(fromDir, fixedSpec));
        if (sourceMap.has(repoRel)) return { repoRel, fixedSpec, content: sourceMap.get(repoRel) };
        if (rootDir) {
            try {
                const abs = path.resolve(rootDir, repoRel);
                if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
                    return { repoRel, fixedSpec, content: fs.readFileSync(abs, "utf8") };
                }
            } catch (_) {}
        }
        return null;
    };

    // Match default `import app from '...'`, `const { default: app } = await import('...')`, or `const app = require('...')`
    const importPatterns = [
        /^\s*import\s+app\s+from\s+(['"][^'"]+['"])\s*;?/m,
        /^\s*const\s+app\s*=\s*require\(\s*(['"][^'"]+['"])\s*\)\s*;?/m,
        /^\s*const\s+\{\s*default\s*:\s*app\s*\}\s*=\s*await\s+import\(\s*(['"][^'"]+['"])\s*\)\s*;?/m,
    ];

    let matched = null;
    let rawSpec = null;
    for (const pat of importPatterns) {
        const m = code.match(pat);
        if (m) {
            matched = m[0];
            rawSpec = m[1].slice(1, -1);
            break;
        }
    }
    if (!matched || !rawSpec) return code;

    const entry = resolveRepoFile(rawSpec);
    if (!entry) return code;

    const exportInfo = inspectModuleExportsAst(entry.content, entry.repoRel);
    if (exportInfo.hasDefaultExport && !exportInfo.hasTopLevelListen) {
        return code;
    }
    if (!exportInfo.hasDefaultExport && exportInfo.namedExports.has("app") && !exportInfo.hasTopLevelListen) {
        const replacement = moduleType === "commonjs"
            ? `const { app } = require(${JSON.stringify(entry.fixedSpec)});`
            : `import { app } from ${JSON.stringify(entry.fixedSpec)};`;
        return code.replace(matched, replacement);
    }

    // Entry does NOT export `app` (or runs `.listen()` at module top level) -> compose isolated Express app from mounted routes
    const entryDir = path.posix.dirname(entry.repoRel);
    const routeImports = [];
    const appUses = [];

    for (let i = 0; i < exportInfo.mountedUses.length; i++) {
        const use = exportInfo.mountedUses[i];
        const absTarget = path.posix.normalize(path.posix.join(entryDir, use.source));
        let relFromTest = path.posix.relative(fromDir, absTarget);
        if (!relFromTest.startsWith(".")) relFromTest = `./${relFromTest}`;
        relFromTest = resolveRelativeSpecifier(relFromTest, testFilePath, sourceCode, rootDir);
        const alias = `_covaiMount${i}_${use.varName.replace(/[^a-zA-Z0-9_$]/g, "")}`;
        if (moduleType === "commonjs") {
            routeImports.push(`const ${alias} = require(${JSON.stringify(relFromTest)});`);
        } else {
            const importBinding = use.imported === "default" ? `default: ${alias}` : `${use.imported}: ${alias}`;
            routeImports.push(`const { ${importBinding} } = await import(${JSON.stringify(relFromTest)});`);
        }
        appUses.push(use.prefix ? `app.use(${JSON.stringify(use.prefix)}, ${alias});` : `app.use(${alias});`);
    }

    // Fallback: if entry didn't register mountedUses explicitly, mount any route modules under sourceCode
    if (routeImports.length === 0) {
        const routeFiles = (sourceCode || []).filter((f) => /routes?\.[cm]?[jt]s$|\/routes\//i.test(f.path || ""));
        routeFiles.forEach((rf, idx) => {
            let relFromTest = path.posix.relative(fromDir, rf.path.replace(/\\/g, "/"));
            if (!relFromTest.startsWith(".")) relFromTest = `./${relFromTest}`;
            const alias = `_covaiRoute${idx}`;
            if (moduleType === "commonjs") {
                routeImports.push(`const ${alias} = require(${JSON.stringify(relFromTest)});`);
            } else {
                routeImports.push(`const { default: ${alias} } = await import(${JSON.stringify(relFromTest)});`);
            }
            appUses.push(`app.use(${alias});`);
        });
    }

    const expressDecl = moduleType === "commonjs"
        ? "const express = require('express');"
        : (/^\s*import\s+express\s+from\s+['"]express['"]/m.test(code) ? "" : "import express from 'express';");

    const composedBlock = [
        expressDecl,
        ...routeImports,
        "const app = express();",
        "app.use(express.json());",
        "app.use(express.urlencoded({ extended: true }));",
        ...exportInfo.inlineHandlers,
        ...appUses,
    ].filter(Boolean).join("\n");

    return code.replace(matched, composedBlock);
};
