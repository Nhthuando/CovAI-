import { createNodeId } from "../utils/projectStructureId.util.js";

const sortTree = (nodes) => nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name);
}).map((node) => ({ ...node, ...(node.children ? { children: sortTree(node.children) } : {}) }));

export const buildProjectStructureTree = (files) => {
    const root = { children: [] };
    for (const file of files) {
        const segments = file.relativePath.split("/");
        let current = root;
        for (let index = 0; index < segments.length - 1; index += 1) {
            const name = segments[index];
            let folder = current.children.find((child) => child.type === "folder" && child.name === name);
            if (!folder) {
                const folderPath = segments.slice(0, index + 1).join("/");
                folder = { id: createNodeId(folderPath, "folder"), name, path: folderPath, type: "folder", children: [] };
                current.children.push(folder);
            }
            current = folder;
        }
        current.children.push({
            id: file.id,
            name: segments.at(-1),
            path: file.relativePath,
            type: "file",
            role: file.role,
            roleEvidence: file.roleEvidence,
            language: file.language,
            moduleFormat: file.moduleFormat,
            functions: file.functions,
            imports: file.imports,
            importedBy: file.importedBy,
            diagnostics: file.diagnostics,
        });
    }
    return sortTree(root.children);
};
