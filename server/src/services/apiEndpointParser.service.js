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
    const appFiles = (sourceCode || []).filter(
        (f) => f.path.includes("app.js") || f.path.includes("index.js") || f.path.includes("server.js") ||
               (f.content && f.content.includes("app.use("))
    );

    for (const file of appFiles) {
        if (!file.content) continue;

        // Track variable -> imported file path
        const varImports = new Map();
        const reqRegex = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        let rMatch;
        while ((rMatch = reqRegex.exec(file.content)) !== null) {
            varImports.set(rMatch[1], rMatch[2]);
        }
        const importRegex = /import\s+(?:(\w+)|\*\s+as\s+(\w+))\s+from\s*['"`]([^'"`]+)['"`]/g;
        let iMatch;
        while ((iMatch = importRegex.exec(file.content)) !== null) {
            varImports.set(iMatch[1] || iMatch[2], iMatch[3]);
        }

        // Standard app.use('/prefix', routeVar)
        const mountRegex = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)/g;
        let match;
        while ((match = mountRegex.exec(file.content)) !== null) {
            mounts.push({
                mountPath: match[1],
                routeVarName: match[2],
                importedPath: varImports.get(match[2]) || null,
                sourceFile: file.path
            });
        }

        // Inline require: app.use('/prefix', require('./routes/...'))
        const inlineMountRegex = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        let inMatch;
        while ((inMatch = inlineMountRegex.exec(file.content)) !== null) {
            mounts.push({
                mountPath: inMatch[1],
                routeVarName: "",
                importedPath: inMatch[2],
                sourceFile: file.path
            });
        }
    }
    return mounts;
};

/**
 * Helper to find the controller file and definition line for a given controller method.
 */
export function findControllerLocation(sourceCode, controllerName, methodName, routeFile, controllerIndexCache = null) {
    if (!methodName && !controllerName) return { controllerFile: null, controllerLine: null, matchedFile: null };

    const targetMethod = methodName || controllerName;
    const controllerFiles = (sourceCode || []).filter(f => {
        const lower = f.path.toLowerCase();
        return (lower.includes('controller') || lower.includes('handler')) &&
               !lower.includes('.test.') && !lower.includes('.spec.');
    });

    if (controllerFiles.length === 0) return { controllerFile: null, controllerLine: null, matchedFile: null };

    // Priority 1: Check if routeFile explicitly imports/references a controller file
    let prioritizedFiles = [...controllerFiles];
    if (routeFile && routeFile.content) {
        for (const cf of controllerFiles) {
            const base = cf.path.split('/').pop().replace(/\.[^.]+$/, '');
            if (routeFile.content.includes(base) || (controllerName && routeFile.content.includes(controllerName))) {
                prioritizedFiles.unshift(cf);
            }
        }
        prioritizedFiles = [...new Set(prioritizedFiles)];
    }

    for (const cFile of prioritizedFiles) {
        if (!cFile.content || !cFile.content.includes(targetMethod)) continue;

        let controllerLine = null;

        // Optimized AST search: Index methods on first parse of this controller file
        if (controllerIndexCache) {
            if (!controllerIndexCache.has(cFile.path)) {
                const methodLines = new Map();
                try {
                    const parsed = parseJavaScriptCode(cFile.content);
                    if (parsed.success) {
                        traverse(parsed.ast, {
                            FunctionDeclaration(p) { if (p.node.id?.name && !methodLines.has(p.node.id.name)) methodLines.set(p.node.id.name, p.node.loc?.start?.line); },
                            VariableDeclarator(p) { if (p.node.id?.name && !methodLines.has(p.node.id.name)) methodLines.set(p.node.id.name, p.node.loc?.start?.line); },
                            ClassMethod(p) { if (p.node.key?.name && !methodLines.has(p.node.key.name)) methodLines.set(p.node.key.name, p.node.loc?.start?.line); },
                            ObjectMethod(p) { if (p.node.key?.name && !methodLines.has(p.node.key.name)) methodLines.set(p.node.key.name, p.node.loc?.start?.line); },
                            ObjectProperty(p) { if (p.node.key?.name && !methodLines.has(p.node.key.name)) methodLines.set(p.node.key.name, p.node.loc?.start?.line); },
                            AssignmentExpression(p) {
                                const left = p.node.left;
                                if (left?.type === "MemberExpression" && left.property?.name && !methodLines.has(left.property.name)) {
                                    methodLines.set(left.property.name, p.node.loc?.start?.line);
                                }
                            }
                        });
                    }
                } catch (_) {}
                controllerIndexCache.set(cFile.path, { methodLines });
            }
            const cached = controllerIndexCache.get(cFile.path);
            controllerLine = cached?.methodLines?.get(targetMethod) || null;
        } else {
            // Fallback AST search if cache is not provided
            try {
                const parsed = parseJavaScriptCode(cFile.content);
                if (parsed.success) {
                    traverse(parsed.ast, {
                        FunctionDeclaration(p) {
                            if (p.node.id?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                p.stop();
                            }
                        },
                        VariableDeclarator(p) {
                            if (p.node.id?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                p.stop();
                            }
                        },
                        ClassMethod(p) {
                            if (p.node.key?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                p.stop();
                            }
                        },
                        ObjectMethod(p) {
                            if (p.node.key?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                p.stop();
                            }
                        },
                        ObjectProperty(p) {
                            if (p.node.key?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                p.stop();
                            }
                        },
                        AssignmentExpression(p) {
                            const left = p.node.left;
                            if (left?.type === "MemberExpression" && left.property?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                p.stop();
                            }
                        }
                    });
                }
            } catch (_) {}
        }

        // Fallback: line-by-line regex search if AST didn't locate line
        if (!controllerLine) {
            const lines = cFile.content.split('\n');
            const targetRegexes = [
                new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${targetMethod}\\b`),
                new RegExp(`(?:const|let|var)\\s+${targetMethod}\\s*=`),
                new RegExp(`(?:exports|module\\.exports)\\.${targetMethod}\\s*=`),
                new RegExp(`\\b${targetMethod}\\s*[:=]\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>|\\w+\\s*=>)`),
                new RegExp(`\\b${targetMethod}\\s*\\(`)
            ];
            for (let i = 0; i < lines.length; i++) {
                if (targetRegexes.some(r => r.test(lines[i]))) {
                    controllerLine = i + 1;
                    break;
                }
            }
        }

        if (controllerLine) {
            return {
                controllerFile: cFile.path,
                controllerLine,
                matchedFile: cFile
            };
        }
    }

    // Secondary fallback: if method is present in file text, return first line containing targetMethod
    const textMatch = prioritizedFiles.find(f => f.content && f.content.includes(targetMethod));
    if (textMatch) {
        const lines = textMatch.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(targetMethod)) {
                return { controllerFile: textMatch.path, controllerLine: i + 1, matchedFile: textMatch };
            }
        }
        return { controllerFile: textMatch.path, controllerLine: 1, matchedFile: textMatch };
    }

    return { controllerFile: null, controllerLine: null, matchedFile: null };
}

export const extractValidEndpoints = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return [];

    const controllerIndexCache = new Map();
    const mounts = extractMountPaths(sourceCode);
    const endpoints = [];

    const routeFiles = sourceCode.filter((f) => {
        const lower = f.path.toLowerCase();
        // Skip obvious test files or mocks
        if (lower.includes(".test.") || lower.includes(".spec.") || lower.includes("__tests__") || lower.includes("mock")) {
            return false;
        }
        // Optimization: Fast-check to avoid AST-parsing non-route files (components, styles, utils, etc.)
        const isRouteNamed = lower.includes("route") || lower.includes("api") || lower.includes("app") || lower.includes("server") || lower.includes("index");
        const hasRouteSyntax = f.content && (f.content.includes("router.") || f.content.includes("app.") || f.content.includes("express") || f.content.includes("Router"));
        return isRouteNamed || hasRouteSyntax;
    });

    for (const routeFile of routeFiles) {
        let mountPath = "";
        for (const mount of mounts) {
            // Strategy 1: Match against resolved importedPath
            if (mount.importedPath) {
                const normImported = mount.importedPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.(js|ts|mjs|cjs)$/, "").toLowerCase();
                const normRouteFile = routeFile.path.replace(/\\/g, "/").toLowerCase();
                if (normRouteFile.endsWith(normImported) || normRouteFile.includes("/" + normImported) || normRouteFile.endsWith(normImported + ".js") || normRouteFile.endsWith(normImported + ".ts")) {
                    mountPath = mount.mountPath;
                    break;
                }
            }
            // Strategy 2: Match variable name with route filename heuristic
            const fileBase = routeFile.path.split("/").pop().replace(/\.(js|ts)$/, "").replace(/[.\-_]/g, "").toLowerCase();
            const varName = (mount.routeVarName || "").toLowerCase();
            if (varName && (varName.includes(fileBase.replace("routes", "").replace("route", "")) || fileBase.includes(varName.replace("routes", "").replace("route", "")))) {
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
                        ["get", "post", "put", "delete", "patch"].includes(path.node.callee.property.name)
                    ) {
                        const objName = path.node.callee.object.name || "";
                        // Exclude obvious HTTP clients
                        if (["axios", "http", "https", "request", "fetch", "supertest"].includes(objName.toLowerCase())) return;

                        const method = path.node.callee.property.name.toUpperCase();
                        const args = path.node.arguments;
                        if (args.length < 2) return;

                        const routePathNode = args[0];
                        if (routePathNode.type !== "StringLiteral") return;
                        
                        // Strict check: if it's not a common router variable, the path MUST start with '/'
                        const isCommonRouter = ["router", "app", "api", "server"].includes(objName.toLowerCase()) || objName.toLowerCase().includes("router");
                        if (!isCommonRouter && !routePathNode.value.startsWith("/")) return;

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
                        let controllerFile = null;
                        let controllerLine = null;

                        const rawMethod = handlerNode.property?.name || (handlerNode.type === "Identifier" ? handlerNode.name : null);
                        if (controllerName || rawMethod) {
                            const location = findControllerLocation(sourceCode, controllerName, rawMethod, routeFile, controllerIndexCache);
                            if (location.controllerFile) {
                                controllerFile = location.controllerFile;
                                controllerLine = location.controllerLine;
                            }

                            const cFile = location.matchedFile;
                            if (cFile && cFile.content) {
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

                        const sourceLine = path.node.loc?.start?.line || null;
                        endpoints.push({
                            method,
                            fullPath: fullPath || "/",
                            sourceFile: routeFile.path,
                            sourceLine,
                            controllerFile,
                            controllerLine,
                            controllerMethod,
                            middleware: middleware.length > 0 ? middleware : undefined,
                            params: params.length > 0 ? params : undefined,
                            requestBodySchema,
                            databaseModels: databaseModels.length > 0 ? [...new Set(databaseModels)] : undefined,
                            provenance: {
                                detectionType: "AST",
                                sourceFile: routeFile.path,
                                sourceLine: sourceLine,
                                resolutionStatus: "FULLY_RESOLVED"
                            }
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
            const upToMatch = file.content.substring(0, match.index);
            const lineMatch = upToMatch.match(/\n/g);
            const sourceLine = lineMatch ? lineMatch.length + 1 : 1;
            
            endpoints.push({
                method: match[1].toUpperCase(),
                fullPath: match[2],
                sourceFile: file.path,
                sourceLine: sourceLine,
                controllerFile: null,
                controllerLine: null,
                provenance: {
                    detectionType: "REGEX_FALLBACK",
                    sourceFile: file.path,
                    sourceLine: sourceLine,
                    resolutionStatus: "PARTIALLY_RESOLVED"
                }
            });
        }
    }
    // Deduplicate based on method + fullPath
    const uniqueEndpointsMap = new Map();
    for (const ep of endpoints) {
        const key = `${ep.method}:${ep.fullPath}`;
        // Prefer AST over REGEX_FALLBACK
        if (!uniqueEndpointsMap.has(key) || ep.provenance?.detectionType === "AST") {
            uniqueEndpointsMap.set(key, ep);
        }
    }

    return Array.from(uniqueEndpointsMap.values());
};
