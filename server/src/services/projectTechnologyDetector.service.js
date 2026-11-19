import fs from "node:fs";
import path from "node:path";
import traverseModule from "@babel/traverse";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { extractEnvReferencesFromAst } from "./environmentDetection.service.js";
import { NODE_BUILTINS } from "./dependencyResolution.service.js";

const traverse = traverseModule.default || traverseModule;

const TECHNOLOGY_PACKAGES = {
    prisma: ["@prisma/client", "prisma"],
    mongoose: ["mongoose"],
    sequelize: ["sequelize", "sequelize-typescript"],
    typeorm: ["typeorm"],
    knex: ["knex"],
    "native-db": ["pg", "mysql", "mysql2", "mongodb", "sqlite3", "better-sqlite3"],
    http: ["axios", "node-fetch", "got", "superagent", "undici"],
    redis: ["redis", "ioredis"],
    filesystem: ["fs", "node:fs", "fs/promises", "node:fs/promises"],
};

const REPO_HINT_REGEX = /(?:repo|repository|dao|store|storage|db|database|prisma|client|service|gateway|adapter)/i;

function normalizePackageName(specifier = "") {
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\")) {
        return null;
    }
    const clean = specifier.replace(/^node:/, "");
    if (specifier.startsWith("node:")) return specifier;
    return clean.startsWith("@") ? clean.split("/").slice(0, 2).join("/") : clean.split("/")[0];
}

function readPackageJson(rootDir) {
    if (!rootDir) return null;
    const candidates = [
        path.join(rootDir, "package.json"),
        path.join(rootDir, "backend", "package.json"),
        path.join(rootDir, "server", "package.json"),
    ];
    for (const cand of candidates) {
        try {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
                return JSON.parse(fs.readFileSync(cand, "utf8"));
            }
        } catch {
            // Ignore malformed package.json and continue searching
        }
    }
    return null;
}

function findPrismaSchema(rootDir) {
    if (!rootDir) return null;
    const candidates = [
        path.join(rootDir, "prisma", "schema.prisma"),
        path.join(rootDir, "schema.prisma"),
        path.join(rootDir, "backend", "prisma", "schema.prisma"),
        path.join(rootDir, "server", "prisma", "schema.prisma"),
    ];
    for (const cand of candidates) {
        try {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
        } catch {
            // Ignore fs errors
        }
    }
    return null;
}

function resolveLocalImport(specifier, sourceFile, rootDir) {
    if (!specifier || !specifier.startsWith(".")) return null;
    let baseDir = rootDir || process.cwd();
    if (sourceFile) {
        const absSource = path.isAbsolute(sourceFile)
            ? sourceFile
            : (rootDir ? path.join(rootDir, sourceFile) : path.resolve(sourceFile));
        baseDir = path.dirname(absSource);
    }
    const candidateBase = path.resolve(baseDir, specifier);
    const extensions = ["", ".ts", ".js", ".tsx", ".jsx", ".mts", ".mjs", ".cts", ".cjs", "/index.ts", "/index.js", "/index.tsx", "/index.jsx"];
    for (const ext of extensions) {
        const full = candidateBase + ext;
        try {
            if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                return full;
            }
        } catch {
            // Ignore
        }
    }
    return null;
}

function matchPackageTechnology(specifier) {
    const pkg = normalizePackageName(specifier);
    if (!pkg) return null;
    for (const [tech, pkgs] of Object.entries(TECHNOLOGY_PACKAGES)) {
        if (pkgs.includes(specifier) || pkgs.includes(pkg)) {
            return tech;
        }
    }
    return null;
}

function collectAstSignals(code, filePath = "") {
    const imports = [];
    const callNames = new Set();
    const memberChains = [];
    const identifiers = new Set();
    let usesFetch = false;
    let envRefs = [];

    if (!code || typeof code !== "string") {
        return { imports, callNames, memberChains, identifiers, usesFetch, envRefs };
    }

    const parsed = parseJavaScriptCode(code, { filePath, allowRecoveredAst: true });
    const ast = parsed?.ast?.type ? parsed.ast : (parsed?.type ? parsed : null);
    if (!ast) {
        return { imports, callNames, memberChains, identifiers, usesFetch, envRefs };
    }

    try {
        envRefs = extractEnvReferencesFromAst(ast, filePath) || [];
    } catch {
        envRefs = [];
    }

    traverse(ast, {
        ImportDeclaration(p) {
            const source = p.node.source?.value;
            if (!source) return;
            const specifiers = (p.node.specifiers || []).map((s) => ({
                local: s.local?.name,
                imported: s.imported?.name || s.imported?.value || (s.type === "ImportDefaultSpecifier" ? "default" : "*"),
                type: s.type,
            }));
            imports.push({ source, kind: "esm", specifiers });
        },
        CallExpression(p) {
            const { callee, arguments: args } = p.node;
            if (callee?.type === "Identifier" && callee.name === "require" && args?.[0]?.type === "StringLiteral") {
                imports.push({ source: args[0].value, kind: "cjs", specifiers: [] });
            }
            if (callee?.type === "Identifier") {
                callNames.add(callee.name);
                if (callee.name === "fetch") usesFetch = true;
            }
            if (callee?.type === "MemberExpression") {
                const parts = [];
                let cur = callee;
                while (cur && cur.type === "MemberExpression") {
                    const prop = cur.property?.name || cur.property?.value;
                    if (prop) parts.unshift(prop);
                    cur = cur.object;
                }
                if (cur?.type === "Identifier") {
                    parts.unshift(cur.name);
                    if (cur.name === "globalThis" && parts[1] === "fetch") usesFetch = true;
                }
                if (parts.length > 0) {
                    memberChains.push(parts.join("."));
                    callNames.add(parts[parts.length - 1]);
                }
            }
        },
        Identifier(p) {
            if (p.node.name) identifiers.add(p.node.name);
        },
    });

    return { imports, callNames, memberChains, identifiers, usesFetch, envRefs };
}

function detectTestFramework({ rootDir, pkgJson, existingTestCode, preferredFramework }) {
    const evidence = [];
    if (existingTestCode) {
        if (/\bfrom\s+['"]vitest['"]|\bvi\s*\.\s*(?:mock|fn|hoisted|spyOn)\b/.test(existingTestCode)) {
            evidence.push("existingTestCode uses vitest/vi");
            return { framework: "vitest", evidence };
        }
        if (/\bfrom\s+['"]@jest\/globals['"]|\bjest\s*\.\s*(?:mock|fn|spyOn)\b/.test(existingTestCode)) {
            evidence.push("existingTestCode uses jest");
            return { framework: "jest", evidence };
        }
    }
    if (rootDir) {
        for (const f of ["vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs"]) {
            if (fs.existsSync(path.join(rootDir, f))) {
                evidence.push(`found ${f}`);
                return { framework: "vitest", evidence };
            }
        }
        for (const f of ["jest.config.ts", "jest.config.js", "jest.config.cjs", "jest.config.mjs"]) {
            if (fs.existsSync(path.join(rootDir, f))) {
                evidence.push(`found ${f}`);
                return { framework: "jest", evidence };
            }
        }
    }
    const allDeps = {
        ...(pkgJson?.dependencies || {}),
        ...(pkgJson?.devDependencies || {}),
    };
    if (allDeps.vitest) {
        evidence.push("package.json declares vitest");
        return { framework: "vitest", evidence };
    }
    if (allDeps.jest) {
        evidence.push("package.json declares jest");
        return { framework: "jest", evidence };
    }
    return {
        framework: preferredFramework === "vitest" ? "vitest" : "jest",
        evidence: ["defaulted to " + (preferredFramework === "vitest" ? "vitest" : "jest")],
    };
}

/**
 * Detects project technologies by combining package metadata, target source AST,
 * transitive local imports, and schema/config files. Never treats package.json
 * alone as proof that a target source file uses a technology.
 *
 * @param {object} params
 * @returns {object} Technology detection report
 */
export function detectProjectTechnologies({
    rootDir = "",
    sourceCode = "",
    sourceFile = "",
    existingTestCode = "",
    packageJson = null,
    preferredFramework = "jest",
} = {}) {
    const pkgJson = packageJson || readPackageJson(rootDir);
    const declaredDepsObj = {
        ...(pkgJson?.dependencies || {}),
        ...(pkgJson?.devDependencies || {}),
        ...(pkgJson?.peerDependencies || {}),
    };
    const declaredPackages = Object.keys(declaredDepsObj);
    const declaredSet = new Set(declaredPackages);

    const { framework, frameworkEvidence } = detectTestFramework({
        rootDir,
        pkgJson,
        existingTestCode,
        preferredFramework,
    });

    const primaryAst = collectAstSignals(sourceCode, sourceFile);
    const relativeDependencies = [];
    const externalDependencies = [];
    const transitiveImports = [];

    for (const imp of primaryAst.imports) {
        if (imp.source.startsWith(".")) {
            const resolvedPath = resolveLocalImport(imp.source, sourceFile, rootDir);
            let roleHint = REPO_HINT_REGEX.test(imp.source) ? "data-access-or-service" : "local-module";
            if (resolvedPath) {
                try {
                    const transCode = fs.readFileSync(resolvedPath, "utf8");
                    const transAst = collectAstSignals(transCode, resolvedPath);
                    for (const tImp of transAst.imports) {
                        transitiveImports.push({ ...tImp, fromLocal: resolvedPath });
                    }
                    const transTechs = transAst.imports.map((i) => matchPackageTechnology(i.source)).filter(Boolean);
                    if (transTechs.length > 0) {
                        roleHint = `wraps:${transTechs.join(",")}`;
                    }
                } catch {
                    // Ignore unreadable transitive file
                }
            }
            relativeDependencies.push({
                specifier: imp.source,
                resolvedPath,
                roleHint,
                specifiers: imp.specifiers,
            });
        } else {
            const pkgName = normalizePackageName(imp.source);
            const tech = matchPackageTechnology(imp.source);
            externalDependencies.push({
                packageName: pkgName || imp.source,
                specifier: imp.source,
                technology: tech,
                isBuiltin: Boolean(pkgName && NODE_BUILTINS.has(pkgName.replace(/^node:/, "").toLowerCase())),
                specifiers: imp.specifiers,
            });
        }
    }

    const technologies = {};
    const ensureTech = (name) => {
        if (!technologies[name]) {
            const pkgs = TECHNOLOGY_PACKAGES[name] || [];
            technologies[name] = {
                detectedInSource: false,
                declaredInPackageJson: pkgs.some((p) => declaredSet.has(p)),
                imports: [],
                signals: [],
                confidence: "low",
            };
        }
        return technologies[name];
    };

    for (const name of Object.keys(TECHNOLOGY_PACKAGES)) {
        ensureTech(name);
    }

    // Record direct external imports in source
    for (const ext of externalDependencies) {
        if (!ext.technology) continue;
        const entry = ensureTech(ext.technology);
        entry.detectedInSource = true;
        if (!entry.imports.includes(ext.specifier)) entry.imports.push(ext.specifier);
        entry.signals.push(`direct import '${ext.specifier}'`);
        entry.confidence = "high";
    }

    // Record transitive imports from local modules
    for (const tImp of transitiveImports) {
        const tech = matchPackageTechnology(tImp.source);
        if (!tech) continue;
        const entry = ensureTech(tech);
        entry.detectedInSource = true;
        if (!entry.imports.includes(tImp.source)) entry.imports.push(tImp.source);
        entry.signals.push(`transitive import '${tImp.source}'`);
        if (entry.confidence === "low") entry.confidence = "medium";
    }

    // AST behavioral signals in primary source
    const chains = primaryAst.memberChains;
    if (chains.some((c) => /\.(findUnique|findFirst|findMany|createMany|updateMany|deleteMany|upsert|aggregate|groupBy|\$transaction)$/.test(c))) {
        const entry = ensureTech("prisma");
        entry.detectedInSource = true;
        entry.signals.push("Prisma query method call in AST");
        entry.confidence = "high";
    }
    if (chains.some((c) => /\.(findById|findOneAndUpdate|findOneAndDelete|countDocuments|populate|lean|exec)$/.test(c))) {
        const entry = ensureTech("mongoose");
        entry.detectedInSource = true;
        entry.signals.push("Mongoose query/chain method call in AST");
        if (entry.confidence === "low") entry.confidence = "medium";
    }
    if (chains.some((c) => /\.(findAll|findByPk|bulkCreate|destroy)$/.test(c))) {
        const entry = ensureTech("sequelize");
        entry.detectedInSource = true;
        entry.signals.push("Sequelize model method call in AST");
        if (entry.confidence === "low") entry.confidence = "medium";
    }
    if (chains.some((c) => /\.(createQueryBuilder|getRepository|leftJoinAndSelect|getMany|getOne)$/.test(c)) || primaryAst.callNames.has("getRepository")) {
        const entry = ensureTech("typeorm");
        entry.detectedInSource = true;
        entry.signals.push("TypeORM repository/queryBuilder call in AST");
        entry.confidence = "high";
    }
    if (primaryAst.usesFetch) {
        const entry = ensureTech("http");
        entry.detectedInSource = true;
        entry.signals.push("global fetch() call in AST");
        entry.confidence = "high";
    }
    if (primaryAst.envRefs.length > 0) {
        const entry = ensureTech("env");
        entry.detectedInSource = true;
        entry.signals.push(`process.env references (${primaryAst.envRefs.map((r) => r.name).join(", ")})`);
        entry.confidence = "high";
    }
    if (relativeDependencies.some((d) => d.roleHint === "data-access-or-service" || d.roleHint.startsWith("wraps:"))) {
        const entry = ensureTech("custom-repository");
        entry.detectedInSource = true;
        entry.signals.push("imports local repository/data-access module");
        entry.confidence = "high";
    }

    const prismaSchemaPath = findPrismaSchema(rootDir);
    const usedTechnologies = Object.entries(technologies)
        .filter(([, v]) => v.detectedInSource)
        .map(([k]) => k);

    return {
        framework,
        frameworkEvidence,
        declaredPackages,
        usedTechnologies,
        technologies,
        relativeDependencies,
        externalDependencies,
        envVariables: primaryAst.envRefs.map((r) => r.name).filter(Boolean),
        schemaFiles: { prismaSchemaPath },
    };
}
