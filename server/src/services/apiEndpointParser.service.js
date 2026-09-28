import { parseJavaScriptCode } from './babelParser.service.js';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

/**
 * API Endpoint Parser Service
 * Extracts mount paths and router methods from Express.js source code
 * to build an inventory of valid endpoints with deep metadata.
 */

export const extractMountPaths = (sourceCode) => {
    const mounts = [];
    const appFiles = sourceCode.filter(
        (f) => f.path.includes("app.js") || f.path.includes("index.js") || f.path.includes("server.js")
    );

    for (const file of appFiles) {
        const mountRegex = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)/g;
        let match;
        while ((match = mountRegex.exec(file.content)) !== null) {
            mounts.push({ mountPath: match[1], routeVarName: match[2] });
        }
    }
    return mounts;
};

export const extractValidEndpoints = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return [];

    const mounts = extractMountPaths(sourceCode);
    const endpoints = [];

    const routeFiles = sourceCode.filter(
        (f) => f.path.includes("route") || f.path.includes("router")
    );

    for (const routeFile of routeFiles) {
        let mountPath = "";
        for (const mount of mounts) {
            const fileBase = routeFile.path.split("/").pop().replace(/\.(js|ts)$/, "").replace(/[.\-_]/g, "").toLowerCase();
            const varName = mount.routeVarName.toLowerCase();
            if (varName.includes(fileBase.replace("routes", "").replace("route", "")) || fileBase.includes(varName.replace("routes", "").replace("route", ""))) {
                mountPath = mount.mountPath;
                break;
            }
        }

        const parseResult = parseJavaScriptCode(routeFile.content);
        if (parseResult.success) {
            traverse(parseResult.ast, {
                CallExpression(path) {
                    if (
                        path.node.callee.type === "MemberExpression" &&
                        path.node.callee.object.name === "router" &&
                        ["get", "post", "put", "delete", "patch"].includes(path.node.callee.property.name)
                    ) {
                        const method = path.node.callee.property.name.toUpperCase();
                        const args = path.node.arguments;
                        if (args.length < 2) return;

                        const routePathNode = args[0];
                        if (routePathNode.type !== "StringLiteral") return;
                        
                        const subPath = routePathNode.value === "/" ? "" : routePathNode.value;
                        const fullPath = mountPath + subPath;

                        const handlerNode = args[args.length - 1];
                        let controllerMethod = null;
                        let controllerName = null;

                        if (handlerNode.type === "MemberExpression") {
                            controllerName = handlerNode.object.name;
                            controllerMethod = `${handlerNode.object.name}.${handlerNode.property.name}`;
                        } else if (handlerNode.type === "Identifier") {
                            controllerMethod = handlerNode.name;
                            controllerName = handlerNode.name;
                        }

                        const middlewareNodes = args.slice(1, args.length - 1);
                        const middleware = middlewareNodes.map(node => {
                            if (node.type === "Identifier") return node.name;
                            if (node.type === "MemberExpression") return `${node.object.name}.${node.property.name}`;
                            return "inline-middleware";
                        });

                        const params = [];
                        const paramRegex = /:([a-zA-Z0-9_]+)/g;
                        let match;
                        while ((match = paramRegex.exec(fullPath)) !== null) {
                            params.push(match[1]);
                        }

                        let requestBodySchema = null;
                        let databaseModels = [];

                        if (controllerName) {
                            const controllerFiles = sourceCode.filter(f => f.path.includes('controller'));
                            for (const cFile of controllerFiles) {
                                const methodName = handlerNode.property?.name || controllerMethod;
                                if (methodName && cFile.content.includes(methodName)) {
                                    // Heuristic for req.body.xxx
                                    const bodyRegex = /req\.body\.([a-zA-Z0-9_]+)/g;
                                    let bMatch;
                                    const bodyParams = [];
                                    while ((bMatch = bodyRegex.exec(cFile.content)) !== null) {
                                        bodyParams.push(bMatch[1]);
                                    }
                                    if (bodyParams.length > 0) requestBodySchema = [...new Set(bodyParams)];

                                    // Heuristic for const { x, y } = req.body;
                                    const destructureRegex = /(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*req\.body/g;
                                    let dMatch;
                                    while ((dMatch = destructureRegex.exec(cFile.content)) !== null) {
                                        const fields = dMatch[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
                                        requestBodySchema = requestBodySchema ? [...new Set([...requestBodySchema, ...fields])] : fields;
                                    }

                                    // Heuristic for Prisma ORM (prisma.model.method)
                                    const prismaRegex = /prisma\.([a-zA-Z0-9_]+)\./g;
                                    let pMatch;
                                    while ((pMatch = prismaRegex.exec(cFile.content)) !== null) {
                                        databaseModels.push(pMatch[1]);
                                    }
                                }
                            }
                        }

                        endpoints.push({
                            method,
                            fullPath: fullPath || "/",
                            sourceFile: routeFile.path,
                            controllerMethod,
                            middleware: middleware.length > 0 ? middleware : undefined,
                            params: params.length > 0 ? params : undefined,
                            requestBodySchema,
                            databaseModels: databaseModels.length > 0 ? [...new Set(databaseModels)] : undefined
                        });
                    }
                }
            });
        }
    }

    // Direct app.get/post endpoints
    const appFiles = sourceCode.filter(
        (f) => f.path.includes("app.js") || f.path.includes("index.js") || f.path.includes("server.js")
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
