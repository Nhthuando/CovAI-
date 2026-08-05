import path from "path";
import { parseJavaScriptFile } from "./babelParser.service.js";
import { discoverSnapshotSourceFiles } from "./fileDiscovery.service.js";
import { extractFunctions } from "./functionExtraction.service.js";
import { PROJECT_STRUCTURE_SCHEMA_VERSION, DIAGNOSTIC_CATEGORIES, MODULE_FORMATS } from "./projectStructure.constants.js";
import { resolveProjectDependencies } from "./projectStructureDependencies.service.js";
import { classifyProjectStructureRole } from "./projectStructureRoles.service.js";
import { buildProjectStructureTree } from "./projectStructureTree.service.js";
import { createNodeId } from "../utils/projectStructureId.util.js";

const languageFor = (relativePath) => path.extname(relativePath).slice(1).toLowerCase();
const projectFormat = (files) => {
    const formats = new Set(files.map((file) => file.moduleFormat).filter((format) => format !== MODULE_FORMATS.UNKNOWN));
    return formats.size > 1 || formats.has(MODULE_FORMATS.MIXED) ? MODULE_FORMATS.MIXED : formats.values().next().value || MODULE_FORMATS.UNKNOWN;
};

export const analyzeProjectStructure = (rootDir, { snapshotId = null } = {}) => {
    const discovery = discoverSnapshotSourceFiles(rootDir);
    const diagnostics = [...discovery.diagnostics];
    const files = discovery.files.map(({ absolutePath, relativePath }) => {
        const role = classifyProjectStructureRole(relativePath);
        const parsed = parseJavaScriptFile(absolutePath);
        const file = {
            id: createNodeId(relativePath), relativePath, language: languageFor(relativePath),
            role: role.role, roleEvidence: role.evidence, roleConfidence: role.confidence,
            moduleFormat: MODULE_FORMATS.UNKNOWN, imports: [], importedBy: [], diagnostics: [], functions: [], ast: parsed.ast,
        };
        if (!parsed.success) {
            const diagnostic = { category: DIAGNOSTIC_CATEGORIES.PARSE, severity: "warning", path: relativePath, message: parsed.error };
            file.diagnostics.push(diagnostic); diagnostics.push(diagnostic);
        } else file.functions = extractFunctions(parsed.ast, relativePath);
        return file;
    });
    if (files.length === 0) diagnostics.push({ category: DIAGNOSTIC_CATEGORIES.DISCOVERY, severity: "warning", message: "No supported source files were found" });
    const dependencies = resolveProjectDependencies({ rootDir, files });
    const functions = files.flatMap((file) => file.functions.map((item) => ({ ...item, dependencies: file.imports })));
    const exportedFunctionCount = functions.filter((item) => item.exported).length;
    return {
        schemaVersion: PROJECT_STRUCTURE_SCHEMA_VERSION, snapshotId, analyzedAt: new Date().toISOString(),
        summary: { totalFiles: files.length, totalFunctions: functions.length, exportedFunctionCount, moduleFormat: projectFormat(files), externalDependencies: dependencies.externalDependencies.map(({ name }) => name) },
        graph: { nodes: files.map(({ ast, ...file }) => file), edges: dependencies.edges, externalDependencies: dependencies.externalDependencies },
        tree: buildProjectStructureTree(files), functions, diagnostics,
    };
};
