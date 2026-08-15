const ROLE_RULES = [
    ["route", /(^|\/)(routes?|router)\//i],
    ["controller", /(^|\/)(controllers?)\//i],
    ["service", /(^|\/)(services?)\//i],
    ["middleware", /(^|\/)(middlewares?)\//i],
    ["model", /(^|\/)(models?|repositories?)\//i],
    ["validator", /(^|\/)(validators?)\//i],
    ["config", /(^|\/)(config|configs)\//i],
    ["utility", /(^|\/)(utils?|helpers?)\//i],
    ["test", /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[^.]+$/i],
    ["component", /(^|\/)(components?)\//i],
    ["page", /(^|\/)(pages?|views?)\//i],
    ["hook", /(^|\/)hooks?\/|(^|\/)use[A-Z][^/]*\.[^.]+$/],
    ["context", /(^|\/)(contexts?)\//i],
    ["layout", /(^|\/)(layouts?)\//i],
    ["style", /\.(css|scss|sass|less)$/i],
];

export const classifyProjectStructureRole = (relativePath) => {
    const path = relativePath.replace(/\\/g, "/");
    const match = ROLE_RULES.find(([, pattern]) => pattern.test(path));
    if (!match) return { role: "unknown", evidence: [], confidence: "none" };
    return { role: match[0], evidence: [`path:${match[1]}`], confidence: "high" };
};

export const aggregateFolderRoles = (files) => {
    const roles = new Map();
    for (const file of files) {
        const parts = file.relativePath.split("/");
        for (let index = 1; index < parts.length; index += 1) {
            const folder = parts.slice(0, index).join("/");
            if (!roles.has(folder)) roles.set(folder, new Map());
            const counts = roles.get(folder);
            counts.set(file.role, (counts.get(file.role) || 0) + 1);
        }
    }
    return roles;
};
