const ROLE_RULES = [
    ["test", /(^|\/)(__tests__|tests?|e2e|cypress)\/|\.(test|spec)\.[^.]+$/i],
    ["config", /(^|\/)(config|configs)\/|(\.config|\.rc)\.[^.]+$|(^|\/)(eslint|vite|tailwind|playwright|jest|vitest|webpack|rollup|babel|postcss|prettier|next|nuxt|tsconfig|jsconfig)(\.config)?\.[^.]+$/i],
    ["route", /(^|\/)(routes?|router|endpoints?)\/|(^|\/)(server|api)\/(index|server|app)\.[^.]+$|^(index|server|app)\.[^.]+$/i],
    ["controller", /(^|\/)(controllers?)\//i],
    ["service", /(^|\/)(services?)\//i],
    ["middleware", /(^|\/)(middlewares?)\//i],
    ["model", /(^|\/)(models?|repositories?|entities|schemas?|db|prisma)\//i],
    ["validator", /(^|\/)(validators?)\//i],
    ["utility", /(^|\/)(utils?|helpers?|lib)\//i],
    ["page", /(^|\/)(pages?|views?|screens?)\//i],
    ["hook", /(^|\/)hooks?\/|(^|\/)use[A-Z][^/]*\.[^.]+$/],
    ["context", /(^|\/)(contexts?|providers?|stores?)\//i],
    ["layout", /(^|\/)(layouts?)\//i],
    ["style", /\.(css|scss|sass|less)$/i],
    ["component", /(^|\/)(components?)\/|(^|\/)(App|main)\.[^.]+$|\.(jsx|tsx)$/i],
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

export const classifyProjectStructureDomain = (relativePath, role = "") => {
    const p = relativePath.replace(/\\/g, "/").toLowerCase();
    
    if (role === "config" || /(config|\.rc|playwright\.config|vite\.config|tailwind|eslint|jest\.config|tsconfig)/.test(p)) {
        return "Platform & Config";
    }
    if (role === "test" || /(\/__tests__\/|\/e2e\/|\/tests\/|\.(test|spec)\.)/.test(p)) {
        if (/product|food/.test(p)) return "Product & Catalog";
        if (/cart/.test(p)) return "Cart";
        if (/payment|checkout/.test(p)) return "Payment";
        if (/auth|user/.test(p)) return "Auth & User";
        return "Quality & Tests";
    }

    if (/cart/.test(p)) return "Cart";
    if (/payment|checkout|invoice|billing/.test(p)) return "Payment";
    if (/product|food|item|catalog|menu|category/.test(p)) return "Product & Catalog";
    if (/auth|user|login|signup|register|profile|account|permission|role/.test(p)) return "Auth & User";
    if (/order|delivery|shipping/.test(p)) return "Order";
    if (/notification|toast|alert|message/.test(p)) return "Notifications";
    
    return "Core & App";
};
