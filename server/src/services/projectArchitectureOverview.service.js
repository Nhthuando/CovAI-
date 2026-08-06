const LAYER_DEFINITIONS = [
    { id: "presentation", label: "Presentation", roles: ["page", "component", "layout", "hook", "context", "style"] },
    { id: "api", label: "API boundary", roles: ["route", "controller", "middleware", "validator"] },
    { id: "application", label: "Application logic", roles: ["service", "model", "utility"] },
    { id: "platform", label: "Platform and configuration", roles: ["config"] },
    { id: "quality", label: "Tests", roles: ["test"] },
    { id: "other", label: "Other source", roles: ["unknown"] },
];

const ENTRY_ROLES = new Set(["route", "page"]);
const entryPointScore = (file) => {
    if (ENTRY_ROLES.has(file.role)) return 0;
    if (/(^|\/)(main|index|app)\.[^.]+$/i.test(file.relativePath)) return 1;
    return 2;
};

const flowTitle = (file) => ENTRY_ROLES.has(file.role)
    ? `${file.role === "route" ? "Request" : "Screen"} flow: ${file.relativePath}`
    : `Application entry: ${file.relativePath}`;

const walkFlow = (entry, edgesByFrom, filesById) => {
    const visited = new Set([entry.id]);
    const queue = [entry.id];
    const edgeIds = new Set();

    while (queue.length > 0 && visited.size < 30) {
        const current = queue.shift();
        for (const edge of edgesByFrom.get(current) || []) {
            if (edge.type !== "internal" || !filesById.has(edge.to)) continue;
            edgeIds.add(edge.id);
            if (!visited.has(edge.to)) {
                visited.add(edge.to);
                queue.push(edge.to);
            }
        }
    }

    return { nodeIds: [...visited], edgeIds: [...edgeIds] };
};

/**
 * Produces product-facing architecture layers and navigable module flows from
 * static metadata. It deliberately describes evidence from code structure,
 * rather than pretending to infer business behavior the source does not show.
 */
export const buildProjectArchitectureOverview = ({ files, edges, functions }) => {
    const filesById = new Map(files.map((file) => [file.id, file]));
    const edgesByFrom = new Map();
    for (const edge of edges) {
        if (!edgesByFrom.has(edge.from)) edgesByFrom.set(edge.from, []);
        edgesByFrom.get(edge.from).push(edge);
    }

    const layers = LAYER_DEFINITIONS.map((definition) => {
        const members = files.filter((file) => definition.roles.includes(file.role));
        return {
            id: definition.id,
            label: definition.label,
            roles: definition.roles,
            fileIds: members.map((file) => file.id),
            files: members.map((file) => file.relativePath),
            functionCount: members.reduce((total, file) => total + file.functions.length, 0),
        };
    }).filter((layer) => layer.fileIds.length > 0);

    const entries = files
        .filter((file) => entryPointScore(file) < 2)
        .sort((left, right) => entryPointScore(left) - entryPointScore(right) || left.relativePath.localeCompare(right.relativePath))
        .slice(0, 20);
    const flows = entries.map((entry) => {
        const graph = walkFlow(entry, edgesByFrom, filesById);
        const paths = graph.nodeIds.map((id) => filesById.get(id)?.relativePath).filter(Boolean);
        return {
            id: `flow:${entry.id}`,
            title: flowTitle(entry),
            kind: ENTRY_ROLES.has(entry.role) ? entry.role : "entry",
            entryFileId: entry.id,
            nodeIds: graph.nodeIds,
            edgeIds: graph.edgeIds,
            files: paths,
            summary: graph.nodeIds.length > 1
                ? `${entry.relativePath} reaches ${graph.nodeIds.length - 1} internal module${graph.nodeIds.length === 2 ? "" : "s"}.`
                : `${entry.relativePath} has no resolved internal module dependency.`,
        };
    });

    const algorithmFlows = functions.map((item) => ({
        functionId: item.id,
        name: item.name,
        filePath: item.filePath,
        exported: item.exported,
        graph: item.controlFlow,
    }));
    const startHere = [...entries.map((entry) => entry.relativePath), ...files.filter((file) => file.role === "service").map((file) => file.relativePath)]
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 8);

    return {
        layers,
        flows,
        algorithmFlows,
        onboarding: {
            summary: `This snapshot contains ${files.length} source files and ${functions.length} functions across ${layers.length} visible architecture layers.`,
            startHere,
            disclaimer: "Flows are derived from static imports and exports; dynamic runtime behavior is shown as diagnostics when it cannot be resolved.",
        },
    };
};
