import path from "path";
import fs from "fs";
import traverse from "@babel/traverse";
import { createEdgeId } from "../utils/projectStructureId.util.js";
import { MODULE_FORMATS, SUPPORTED_SOURCE_EXTENSIONS } from "./projectStructure.constants.js";

const packageName = (specifier) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const relativeCandidates = (fromPath, specifier) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
    const extension = path.posix.extname(base);
    return extension ? [base] : [
        ...SUPPORTED_SOURCE_EXTENSIONS.map((candidate) => `${base}${candidate}`),
        ...SUPPORTED_SOURCE_EXTENSIONS.map((candidate) => `${base}/index${candidate}`),
    ];
};

const manifestDependencies = (rootDir) => {
    const dependencies = new Map();
    const walk = (directory) => {
        let entries = [];
        try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory() && !["node_modules", ".git", "dist", "build"].includes(entry.name)) walk(fullPath);
            if (entry.isFile() && entry.name === "package.json") {
                try {
                    const manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
                    for (const [field, category] of [["dependencies", "production"], ["peerDependencies", "production"], ["devDependencies", "development"]]) {
                        for (const name of Object.keys(manifest[field] || {})) {
                            const existing = dependencies.get(name) || { name, categories: [], origins: [] };
                            if (!existing.categories.includes(category)) existing.categories.push(category);
                            const origin = path.relative(rootDir, fullPath).replace(/\\/g, "/") || "package.json";
                            if (!existing.origins.includes(origin)) existing.origins.push(origin);
                            dependencies.set(name, existing);
                        }
                    }
                } catch { /* an invalid manifest is not source-analysis fatal */ }
            }
        }
    };
    walk(rootDir);
    return dependencies;
};

const collectReferences = (ast) => {
    const references = [];
    const add = (specifier, type, literal = true) => references.push({ specifier, type, literal });
    traverse(ast, {
        ImportDeclaration(p) { add(p.node.source.value, "import"); },
        ExportNamedDeclaration(p) { if (p.node.source) add(p.node.source.value, "re-export"); },
        ExportAllDeclaration(p) { add(p.node.source.value, "re-export"); },
        CallExpression(p) {
            if (p.node.callee.name === "require") {
                const arg = p.node.arguments[0];
                add(arg?.value, "require", arg?.type === "StringLiteral");
            }
            if (p.node.callee.type === "Import") {
                const arg = p.node.arguments[0];
                add(arg?.value, "dynamic-import", arg?.type === "StringLiteral");
            }
        },
        ImportExpression(p) {
            const source = p.node.source;
            add(source?.value, "dynamic-import", source?.type === "StringLiteral");
        },
    });
    return references;
};

export const detectModuleFormat = (ast) => {
    let esm = false; let commonJs = false;
    traverse(ast, {
        ImportDeclaration() { esm = true; }, ExportNamedDeclaration() { esm = true; }, ExportDefaultDeclaration() { esm = true; }, ExportAllDeclaration() { esm = true; },
        CallExpression(p) { if (p.node.callee.name === "require") commonJs = true; },
        AssignmentExpression(p) { if (p.node.left?.object?.name === "module" || p.node.left?.object?.name === "exports") commonJs = true; },
    });
    return esm && commonJs ? MODULE_FORMATS.MIXED : esm ? MODULE_FORMATS.ESM : commonJs ? MODULE_FORMATS.COMMON_JS : MODULE_FORMATS.UNKNOWN;
};

export const resolveProjectDependencies = ({ rootDir, files }) => {
    const byPath = new Map(files.map((file) => [file.relativePath, file]));
    const externalPackages = manifestDependencies(rootDir);
    const edges = [];
    for (const file of files) {
        file.imports = [];
        file.importedBy = [];
    }
    for (const file of files) {
        if (!file.ast) continue;
        file.moduleFormat = detectModuleFormat(file.ast);
        for (const reference of collectReferences(file.ast)) {
            if (!reference.literal) {
                file.imports.push({ type: "unresolved", specifier: null, reason: "Dynamic import path is not a string literal" });
                continue;
            }
            if (reference.specifier.startsWith(".")) {
                const target = relativeCandidates(file.relativePath, reference.specifier).find((candidate) => byPath.has(candidate));
                if (!target) {
                    file.imports.push({ type: "unresolved", specifier: reference.specifier, reason: "Relative source file was not found" });
                    continue;
                }
                const edge = { id: createEdgeId(file.relativePath, target, reference.type), type: "internal", relationship: reference.type, from: file.id, to: byPath.get(target).id, path: target };
                file.imports.push({ type: "internal", specifier: reference.specifier, path: target, relationship: reference.type });
                byPath.get(target).importedBy.push({ path: file.relativePath, relationship: reference.type });
                edges.push(edge);
            } else {
                const name = packageName(reference.specifier);
                const metadata = externalPackages.get(name) || { name, categories: ["unknown"], origins: [] };
                externalPackages.set(name, metadata);
                file.imports.push({ type: "external", specifier: reference.specifier, package: name, categories: metadata.categories });
                edges.push({ id: createEdgeId(file.relativePath, name, reference.type), type: "external", relationship: reference.type, from: file.id, package: name });
            }
        }
        delete file.ast;
    }
    return { edges, externalDependencies: [...externalPackages.values()].sort((left, right) => left.name.localeCompare(right.name)) };
};
