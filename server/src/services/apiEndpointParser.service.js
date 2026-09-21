/**
 * API Endpoint Parser Service
 * Extracts mount paths and router methods from Express.js source code
 * to build an inventory of valid endpoints.
 */

/**
 * Extracts mount paths from app.js/index.js (e.g. app.use('/api/users', userRoutes)).
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {Array<{mountPath: string, routeVarName: string}>}
 */
export const extractMountPaths = (sourceCode) => {
    const mounts = [];
    const appFiles = sourceCode.filter(
        (f) => f.path.includes("app.js") || f.path.includes("index.js")
    );

    for (const file of appFiles) {
        // Match patterns like: app.use('/api/users', userRoutes)
        const mountRegex = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)/g;
        let match;
        while ((match = mountRegex.exec(file.content)) !== null) {
            mounts.push({ mountPath: match[1], routeVarName: match[2] });
        }
    }
    return mounts;
};

/**
 * Extracts route definitions from router files (e.g. router.get('/', handler)).
 * @param {string} content - File content
 * @returns {Array<{method: string, subPath: string}>}
 */
export const extractRouterMethods = (content) => {
    const routes = [];
    // Match patterns like: router.get('/', ...) or router.post('/:id', ...)
    const routeRegex = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
        routes.push({ method: match[1].toUpperCase(), subPath: match[2] });
    }
    return routes;
};

/**
 * Builds a structured list of all valid API endpoints from source code.
 * Combines app.use() mount paths with router method definitions.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {Array<{method: string, fullPath: string, sourceFile: string}>}
 */
export const extractValidEndpoints = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return [];

    const mounts = extractMountPaths(sourceCode);
    const endpoints = [];

    const routeFiles = sourceCode.filter(
        (f) => f.path.includes("route") || f.path.includes("router")
    );

    for (const routeFile of routeFiles) {
        const routerMethods = extractRouterMethods(routeFile.content);

        // Find the mount path for this route file
        let mountPath = "";
        for (const mount of mounts) {
            // Heuristic: match variable name to file name
            const fileBase = routeFile.path.split("/").pop().replace(/\.(js|ts)$/, "").replace(/[.\-_]/g, "").toLowerCase();
            const varName = mount.routeVarName.toLowerCase();
            if (varName.includes(fileBase.replace("routes", "").replace("route", "")) || fileBase.includes(varName.replace("routes", "").replace("route", ""))) {
                mountPath = mount.mountPath;
                break;
            }
        }

        for (const route of routerMethods) {
            const subPath = route.subPath === "/" ? "" : route.subPath;
            const fullPath = mountPath + subPath;
            endpoints.push({
                method: route.method,
                fullPath: fullPath || "/",
                sourceFile: routeFile.path,
            });
        }
    }

    // Also extract direct app.get/post/etc from app files
    const appFiles = sourceCode.filter(
        (f) => f.path.includes("app.js") || f.path.includes("index.js")
    );
    for (const file of appFiles) {
        const directRouteRegex = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
        let match;
        while ((match = directRouteRegex.exec(file.content)) !== null) {
            endpoints.push({
                method: match[1].toUpperCase(),
                fullPath: match[2],
                sourceFile: file.path,
            });
        }
    }

    return endpoints;
};
