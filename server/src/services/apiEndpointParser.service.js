import { parseJavaScriptCode } from './babelParser.service.js';
import _traverse from '@babel/traverse';
import * as fsPromises from 'fs/promises';
import path from 'path';

const traverse = _traverse.default || _traverse;

/**
 * Recursively scans directory and loads source files using fsPromises.
 */
async function loadSourceFilesFromDir(dirPath) {
    const files = [];
    try {
        const entries = await fsPromises.readdir(dirPath);
        for (const entry of entries) {
            if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build') {
                continue;
            }
            if (entry.includes('.test.') || entry.includes('.spec.') || entry.includes('__tests__')) {
                continue;
            }
            const fullPath = path.join(dirPath, entry);
            const stat = await fsPromises.stat(fullPath);
            if (stat.isDirectory() && !/\.(js|ts|mjs|cjs)$/i.test(entry)) {
                const sub = await loadSourceFilesFromDir(fullPath);
                files.push(...sub);
            } else if (/\.(js|ts)$/.test(entry)) {
                const content = await fsPromises.readFile(fullPath, 'utf8');
                files.push({ path: fullPath, content });
            }
        }
    } catch (_) {}
    return files;
}

export const extractMountPaths = (sourceCode) => {
    if (!Array.isArray(sourceCode)) return [];
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
            const upToMatch = file.content.substring(0, match.index);
            const mountLine = (upToMatch.match(/\n/g) || []).length + 1;
            mounts.push({
                mountPath: match[1],
                routeVarName: match[2],
                importedPath: varImports.get(match[2]) || null,
                sourceFile: file.path,
                mountLine
            });
        }

        // Inline require: app.use('/prefix', require('./routes/...'))
        const inlineMountRegex = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        let inMatch;
        while ((inMatch = inlineMountRegex.exec(file.content)) !== null) {
            const upToInMatch = file.content.substring(0, inMatch.index);
            const mountLine = (upToInMatch.match(/\n/g) || []).length + 1;
            mounts.push({
                mountPath: inMatch[1],
                routeVarName: "",
                importedPath: inMatch[2],
                sourceFile: file.path,
                mountLine
            });
        }
    }
    return mounts;
};

export const extractValidEndpoints = (sourceCodeOrRootDir, scanDir = null) => {
    if (typeof sourceCodeOrRootDir === 'string') {
        const targetDir = scanDir || sourceCodeOrRootDir;
        return (async () => {
            const sourceFiles = await loadSourceFilesFromDir(targetDir);
            return parseEndpointsFromFiles(sourceFiles);
        })();
    }
    const sourceFiles = Array.isArray(sourceCodeOrRootDir) ? sourceCodeOrRootDir : [];
    return parseEndpointsFromFiles(sourceFiles);
};

/**
 * Helper to resolve middlewares to their definitions and classifications.
 */
export function resolveMiddlewares(sourceCode, routeFile, middlewareNames = []) {
    if (!Array.isArray(middlewareNames) || middlewareNames.length === 0) return [];

    const middlewareFiles = (sourceCode || []).filter(f => {
        const lower = f.path.toLowerCase();
        return (lower.includes('middleware') || lower.includes('auth') || lower.includes('guard')) &&
               !lower.includes('.test.') && !lower.includes('.spec.') && !lower.includes('mock');
    });

    return middlewareNames.map(name => {
        let type = "CUSTOM_MIDDLEWARE";
        const lowerName = name.toLowerCase();
        if (lowerName.includes("auth") || lowerName.includes("token") || lowerName.includes("jwt") || lowerName.includes("protect") || lowerName.includes("admin") || lowerName.includes("user")) {
            type = "AUTHENTICATION";
        } else if (lowerName.includes("validate") || lowerName.includes("validator") || lowerName.includes("schema") || lowerName.includes("check") || lowerName.includes("joi") || lowerName.includes("zod")) {
            type = "VALIDATION";
        } else if (lowerName.includes("rate") || lowerName.includes("limit") || lowerName.includes("cors") || lowerName.includes("helmet") || lowerName.includes("log") || lowerName.includes("upload")) {
            type = "SECURITY_OR_UTILITY";
        }

        let file = null;
        let line = null;
        for (const mf of middlewareFiles) {
            if (mf.content && mf.content.includes(name)) {
                file = mf.path;
                const lines = mf.content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(name)) {
                        line = i + 1;
                        break;
                    }
                }
                break;
            }
        }

        return {
            name,
            type,
            file,
            line,
            verified: !!file
        };
    });
}

/**
 * Helper to find the service file and method invoked by a controller.
 */
export function findServiceLocation(sourceCode, controllerContent, controllerFile) {
    if (!controllerContent) {
        return {
            status: "DIRECT_CONTROLLER",
            description: "No separate service layer detected; controller executes logic directly",
            file: null,
            method: null,
            verified: false
        };
    }

    const serviceFiles = (sourceCode || []).filter(f => {
        const lower = f.path.toLowerCase();
        return lower.includes('service') &&
               !lower.includes('.test.') && !lower.includes('.spec.') && !lower.includes('mock');
    });

    if (serviceFiles.length === 0) {
        return {
            status: "DIRECT_CONTROLLER",
            description: "No separate service layer detected; controller executes logic directly",
            file: null,
            method: null,
            verified: false
        };
    }

    const importRegex = /(?:import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s*['"`]([^'"`]+service[^'"`]*)['"`]|(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"`]([^'"`]+service[^'"`]*)['"`]\))/gi;
    let match;
    let candidateServicePath = null;
    let serviceVarName = null;
    while ((match = importRegex.exec(controllerContent)) !== null) {
        serviceVarName = match[2] || match[3] || match[5];
        candidateServicePath = match[4] || match[6];
        if (candidateServicePath) break;
    }

    let matchedServiceFile = null;
    if (candidateServicePath) {
        const norm = candidateServicePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.(js|ts)$/, "").toLowerCase();
        matchedServiceFile = serviceFiles.find(sf => sf.path.toLowerCase().includes(norm));
    }

    if (!matchedServiceFile && serviceVarName) {
        const cleanName = serviceVarName.toLowerCase().replace("service", "");
        matchedServiceFile = serviceFiles.find(sf => sf.path.toLowerCase().includes(cleanName));
    }

    if (!matchedServiceFile && controllerFile) {
        const ctrlBase = controllerFile.split("/").pop().replace(/controller|\.js|\.ts/gi, "").toLowerCase();
        if (ctrlBase) {
            matchedServiceFile = serviceFiles.find(sf => sf.path.toLowerCase().includes(ctrlBase));
        }
    }

    if (!matchedServiceFile) {
        return {
            status: "DIRECT_CONTROLLER",
            description: "No separate service layer detected; controller executes logic directly",
            file: null,
            method: null,
            verified: false
        };
    }

    let serviceMethod = null;
    let serviceLineStart = null;
    let serviceLineEnd = null;

    const callRegex = /(?:(\w+Service|\w+service|service)\.(\w+)\s*\()/g;
    let cMatch;
    while ((cMatch = callRegex.exec(controllerContent)) !== null) {
        serviceMethod = cMatch[2];
        break;
    }

    if (serviceMethod && matchedServiceFile.content) {
        const lines = matchedServiceFile.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(serviceMethod)) {
                serviceLineStart = i + 1;
                serviceLineEnd = i + 1;
                break;
            }
        }
    }

    return {
        status: "FOUND_IN_SOURCE",
        name: serviceMethod ? `${matchedServiceFile.path.split('/').pop().replace(/\.[^.]+$/, '')}.${serviceMethod}` : matchedServiceFile.path.split('/').pop(),
        file: matchedServiceFile.path,
        lineStart: serviceLineStart || 1,
        lineEnd: serviceLineEnd || serviceLineStart || 1,
        verified: true
    };
}

/**
 * Helper to find the controller file, lines, and behavioral metadata for a controller method.
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
        let controllerEndLine = null;

        // Optimized AST search: Index methods on first parse of this controller file
        if (controllerIndexCache) {
            if (!controllerIndexCache.has(cFile.path)) {
                const methodLines = new Map();
                try {
                    const parsed = parseJavaScriptCode(cFile.content);
                    if (parsed.success) {
                        traverse(parsed.ast, {
                            FunctionDeclaration(p) {
                                if (p.node.id?.name && !methodLines.has(p.node.id.name)) {
                                    methodLines.set(p.node.id.name, { start: p.node.loc?.start?.line, end: p.node.loc?.end?.line });
                                }
                            },
                            VariableDeclarator(p) {
                                if (p.node.id?.name && !methodLines.has(p.node.id.name)) {
                                    methodLines.set(p.node.id.name, { start: p.node.loc?.start?.line, end: p.node.loc?.end?.line });
                                }
                            },
                            ClassMethod(p) {
                                if (p.node.key?.name && !methodLines.has(p.node.key.name)) {
                                    methodLines.set(p.node.key.name, { start: p.node.loc?.start?.line, end: p.node.loc?.end?.line });
                                }
                            },
                            ObjectMethod(p) {
                                if (p.node.key?.name && !methodLines.has(p.node.key.name)) {
                                    methodLines.set(p.node.key.name, { start: p.node.loc?.start?.line, end: p.node.loc?.end?.line });
                                }
                            },
                            ObjectProperty(p) {
                                if (p.node.key?.name && !methodLines.has(p.node.key.name)) {
                                    methodLines.set(p.node.key.name, { start: p.node.loc?.start?.line, end: p.node.loc?.end?.line });
                                }
                            },
                            AssignmentExpression(p) {
                                const left = p.node.left;
                                if (left?.type === "MemberExpression" && left.property?.name && !methodLines.has(left.property.name)) {
                                    methodLines.set(left.property.name, { start: p.node.loc?.start?.line, end: p.node.loc?.end?.line });
                                }
                            }
                        });
                    }
                } catch (_) {}
                controllerIndexCache.set(cFile.path, { methodLines });
            }
            const cached = controllerIndexCache.get(cFile.path);
            const loc = cached?.methodLines?.get(targetMethod);
            if (loc) {
                controllerLine = typeof loc === 'object' ? loc.start : loc;
                controllerEndLine = typeof loc === 'object' ? loc.end : null;
            }
        } else {
            // Fallback AST search if cache is not provided
            try {
                const parsed = parseJavaScriptCode(cFile.content);
                if (parsed.success) {
                    traverse(parsed.ast, {
                        FunctionDeclaration(p) {
                            if (p.node.id?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                controllerEndLine = p.node.loc?.end?.line;
                                p.stop();
                            }
                        },
                        VariableDeclarator(p) {
                            if (p.node.id?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                controllerEndLine = p.node.loc?.end?.line;
                                p.stop();
                            }
                        },
                        ClassMethod(p) {
                            if (p.node.key?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                controllerEndLine = p.node.loc?.end?.line;
                                p.stop();
                            }
                        },
                        ObjectMethod(p) {
                            if (p.node.key?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                controllerEndLine = p.node.loc?.end?.line;
                                p.stop();
                            }
                        },
                        ObjectProperty(p) {
                            if (p.node.key?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                controllerEndLine = p.node.loc?.end?.line;
                                p.stop();
                            }
                        },
                        AssignmentExpression(p) {
                            const left = p.node.left;
                            if (left?.type === "MemberExpression" && left.property?.name === targetMethod) {
                                controllerLine = p.node.loc?.start?.line;
                                controllerEndLine = p.node.loc?.end?.line;
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
            const cLines = cFile.content.split('\n');
            const startLine = controllerLine;
            const endLine = controllerEndLine || Math.min(startLine + 25, cLines.length);
            const snippet = cLines.slice(startLine - 1, endLine).join('\n');

            // Static behavioral analysis scoped strictly to the function snippet
            // 1. Query parameters
            const queryParams = [];
            const queryRegex = /req\.query\.([a-zA-Z0-9_]+)/g;
            let qm;
            while ((qm = queryRegex.exec(snippet)) !== null) {
                queryParams.push(qm[1]);
            }
            const queryDestructRegex = /(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*req\.query/g;
            let qdm;
            while ((qdm = queryDestructRegex.exec(snippet)) !== null) {
                const fields = qdm[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
                queryParams.push(...fields);
            }

            // 2. Response status codes (scoped to function snippet)
            const responseStatusCodes = [];
            const statusRegex = /res\.(?:status|sendStatus)\(\s*(\d{3})\s*\)/g;
            let sm;
            while ((sm = statusRegex.exec(snippet)) !== null) {
                const code = Number(sm[1]);
                if (!responseStatusCodes.includes(code)) {
                    responseStatusCodes.push(code);
                }
            }
            // Include default 200 if res.json or res.send is called without an explicit status prefix
            const snippetWithoutChainedStatus = snippet.replace(/res\.(?:status|sendStatus)\s*\([^)]*\)\s*\.\s*(?:json|send)/g, '');
            if (!responseStatusCodes.includes(200) && (snippetWithoutChainedStatus.includes("res.json") || snippetWithoutChainedStatus.includes("res.send"))) {
                responseStatusCodes.push(200);
            }

            // 3. Request body parameters (scoped to function snippet)
            const bodyParams = [];
            const bodyRegex = /req\.body\.([a-zA-Z0-9_]+)/g;
            let bm;
            while ((bm = bodyRegex.exec(snippet)) !== null) {
                bodyParams.push(bm[1]);
            }
            const destructureRegex = /(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*req\.body/g;
            let bdm;
            while ((bdm = destructureRegex.exec(snippet)) !== null) {
                const fields = bdm[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
                bodyParams.push(...fields);
            }

            // 4. Prisma database models (scoped to function snippet)
            const databaseModels = [];
            const prismaRegex = /prisma\.([a-zA-Z0-9_]+)\./g;
            let pm;
            while ((pm = prismaRegex.exec(snippet)) !== null) {
                databaseModels.push(pm[1]);
            }

            // 5. Error handling
            const errorHandling = {
                hasTryCatch: snippet.includes("try") && snippet.includes("catch"),
                callsNext: snippet.includes("next(")
            };

            // 6. Service layer discovery
            const serviceLayer = findServiceLocation(sourceCode, snippet, cFile.path) || findServiceLocation(sourceCode, cFile.content, cFile.path);

            return {
                controllerFile: cFile.path,
                controllerLine: startLine,
                controllerLineStart: startLine,
                controllerLineEnd: endLine,
                controllerSnippet: snippet,
                queryParams: [...new Set(queryParams)],
                responseStatusCodes: [...new Set(responseStatusCodes)],
                requestBodySchema: bodyParams.length > 0 ? [...new Set(bodyParams)] : null,
                databaseModels: [...new Set(databaseModels)],
                errorHandling,
                serviceLayer,
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
                return {
                    controllerFile: textMatch.path,
                    controllerLine: i + 1,
                    controllerLineStart: i + 1,
                    controllerLineEnd: Math.min(i + 20, lines.length),
                    controllerSnippet: lines.slice(i, Math.min(i + 20, lines.length)).join('\n'),
                    queryParams: [],
                    responseStatusCodes: [200],
                    errorHandling: { hasTryCatch: false, callsNext: false },
                    serviceLayer: findServiceLocation(sourceCode, textMatch.content, textMatch.path),
                    matchedFile: textMatch
                };
            }
        }
        return {
            controllerFile: textMatch.path,
            controllerLine: 1,
            controllerLineStart: 1,
            controllerLineEnd: Math.min(20, lines.length),
            controllerSnippet: lines.slice(0, Math.min(20, lines.length)).join('\n'),
            queryParams: [],
            responseStatusCodes: [200],
            errorHandling: { hasTryCatch: false, callsNext: false },
            serviceLayer: findServiceLocation(sourceCode, textMatch.content, textMatch.path),
            matchedFile: textMatch
        };
    }

    return { controllerFile: null, controllerLine: null, matchedFile: null };
}

export const parseEndpointsFromFiles = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return [];

    const sourceFiles = Array.isArray(sourceCode) ? sourceCode : [];
    const controllerIndexCache = new Map();
    const mounts = extractMountPaths(sourceCode);

    const endpoints = [];

    const routeFiles = sourceFiles.filter((f) => {
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
        let matchedMount = null;
        for (const mount of mounts) {
            // Strategy 1: Match against resolved importedPath
            if (mount.importedPath) {
                const normImported = mount.importedPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.(js|ts|mjs|cjs)$/, "").toLowerCase();
                const normRouteFile = routeFile.path.replace(/\\/g, "/").toLowerCase();
                if (normRouteFile.endsWith(normImported) || normRouteFile.includes("/" + normImported) || normRouteFile.endsWith(normImported + ".js") || normRouteFile.endsWith(normImported + ".ts")) {
                    mountPath = mount.mountPath;
                    matchedMount = mount;
                    break;
                }
            }
            // Strategy 2: Match variable name with route filename heuristic
            const fileBase = routeFile.path.split("/").pop().replace(/\.(js|ts)$/, "").replace(/[.\-_]/g, "").toLowerCase();
            const varName = (mount.routeVarName || "").toLowerCase();
            if (varName && (varName.includes(fileBase.replace("routes", "").replace("route", "")) || fileBase.includes(varName.replace("routes", "").replace("route", "")))) {
                mountPath = mount.mountPath;
                matchedMount = mount;
                break;
            }
        }

        const parseResult = parseJavaScriptCode(routeFile.content);
        if (parseResult.success) {
            traverse(parseResult.ast, {
                CallExpression(astPath) {
                    if (
                        astPath.node.callee.type === "MemberExpression" &&
                        ["get", "post", "put", "delete", "patch"].includes(astPath.node.callee.property.name)
                    ) {
                        const objName = astPath.node.callee.object.name || "";
                        // Exclude obvious HTTP clients
                        if (["axios", "http", "https", "request", "fetch", "supertest"].includes(objName.toLowerCase())) return;

                        const method = astPath.node.callee.property.name.toUpperCase();
                        const args = astPath.node.arguments;
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
                        const rawMiddlewareNames = middlewareNodes.map(node => {
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
                        let controllerLineStart = null;
                        let controllerLineEnd = null;
                        let controllerSnippet = null;
                        let queryParams = [];
                        let responseStatusCodes = [];
                        let errorHandling = { hasTryCatch: false, callsNext: false };
                        let serviceLayer = null;

                        const rawMethod = handlerNode.property?.name || (handlerNode.type === "Identifier" ? handlerNode.name : null);
                        if (controllerName || rawMethod) {
                            const location = findControllerLocation(sourceCode, controllerName, rawMethod, routeFile, controllerIndexCache);
                            if (location.controllerFile) {
                                controllerFile = location.controllerFile;
                                controllerLine = location.controllerLine;
                                controllerLineStart = location.controllerLineStart || location.controllerLine;
                                controllerLineEnd = location.controllerLineEnd;
                                controllerSnippet = location.controllerSnippet;
                                queryParams = location.queryParams || [];
                                responseStatusCodes = location.responseStatusCodes || [];
                                errorHandling = location.errorHandling || { hasTryCatch: false, callsNext: false };
                                serviceLayer = location.serviceLayer;
                                requestBodySchema = location.requestBodySchema || null;
                                databaseModels = location.databaseModels || [];
                            }
                        } else if (handlerNode.type === "FunctionExpression" || handlerNode.type === "ArrowFunctionExpression") {
                            // Inline route handler: scope behavioral extraction strictly to the inline function snippet
                            const inlineStart = handlerNode.loc?.start?.line;
                            const inlineEnd = handlerNode.loc?.end?.line;
                            if (inlineStart && inlineEnd) {
                                const rLines = routeFile.content.split('\n');
                                controllerFile = null;
                                controllerLine = null;
                                controllerLineStart = inlineStart;
                                controllerLineEnd = inlineEnd;
                                controllerSnippet = rLines.slice(inlineStart - 1, inlineEnd).join('\n');

                                const bodyParams = [];
                                const bodyRegex = /req\.body\.([a-zA-Z0-9_]+)/g;
                                let bm;
                                while ((bm = bodyRegex.exec(controllerSnippet)) !== null) {
                                    bodyParams.push(bm[1]);
                                }
                                const destructureRegex = /(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*req\.body/g;
                                let bdm;
                                while ((bdm = destructureRegex.exec(controllerSnippet)) !== null) {
                                    const fields = bdm[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
                                    bodyParams.push(...fields);
                                }
                                if (bodyParams.length > 0) requestBodySchema = [...new Set(bodyParams)];

                                const prismaRegex = /prisma\.([a-zA-Z0-9_]+)\./g;
                                let pm;
                                while ((pm = prismaRegex.exec(controllerSnippet)) !== null) {
                                    databaseModels.push(pm[1]);
                                }

                                const statusRegex = /res\.(?:status|sendStatus)\(\s*(\d{3})\s*\)/g;
                                let sm;
                                while ((sm = statusRegex.exec(controllerSnippet)) !== null) {
                                    const code = Number(sm[1]);
                                    if (!responseStatusCodes.includes(code)) {
                                        responseStatusCodes.push(code);

                                    }
                                }
                                const snippetWithoutChainedStatus = controllerSnippet.replace(/res\.(?:status|sendStatus)\s*\([^)]*\)\s*\.\s*(?:json|send)/g, '');
                                if (!responseStatusCodes.includes(200) && (snippetWithoutChainedStatus.includes("res.json") || snippetWithoutChainedStatus.includes("res.send"))) {
                                    responseStatusCodes.push(200);
                                }

                                errorHandling = {
                                    hasTryCatch: controllerSnippet.includes("try") && controllerSnippet.includes("catch"),
                                    callsNext: controllerSnippet.includes("next(")
                                };
                            }
                        }

                        const sourceLineStart = astPath.node?.loc?.start?.line ?? null;
                        const sourceLineEnd = astPath.node?.loc?.end?.line ?? sourceLineStart;
                        const rLines = routeFile.content.split('\n');
                        const routeSnippet = sourceLineStart ? rLines.slice(sourceLineStart - 1, sourceLineEnd || sourceLineStart).join('\n') : "";

                        const resolvedMiddlewares = resolveMiddlewares(sourceCode, routeFile, rawMiddlewareNames);

                        const requestProcessingChain = {
                            routeRegistration: {
                                mountPrefix: mountPath || "/",
                                mountFile: matchedMount?.sourceFile || routeFile.path,
                                mountLine: matchedMount?.mountLine || 1,
                                sourceFile: routeFile.path,
                                sourceLineStart,
                                sourceLineEnd,
                                routeSnippet: routeSnippet.trim(),
                                method,
                                path: fullPath || "/",
                                verified: true
                            },
                            middlewares: resolvedMiddlewares,
                            controller: {
                                name: controllerMethod || "inlineHandler",
                                file: controllerFile,
                                lineStart: controllerLineStart || controllerLine || null,
                                lineEnd: controllerLineEnd || controllerLine || null,
                                snippet: controllerSnippet || null,
                                verified: !!controllerFile
                            },
                            controllerHandler: {
                                name: controllerMethod || "inlineHandler",
                                file: controllerFile,
                                controllerFile: controllerFile,
                                lineStart: controllerLineStart || controllerLine || null,
                                controllerLineStart: controllerLineStart || controllerLine || null,
                                lineEnd: controllerLineEnd || controllerLine || null,
                                controllerLineEnd: controllerLineEnd || controllerLine || null,
                                snippet: controllerSnippet || null,
                                controllerSnippet: controllerSnippet || null,
                                verified: !!controllerFile
                            },
                            service: serviceLayer || {
                                status: "DIRECT_CONTROLLER",
                                description: "Controller handles database models directly without a separate service layer",
                                file: null,
                                method: null,
                                verified: false
                            },
                            serviceLayer: serviceLayer || {
                                status: "DIRECT_CONTROLLER",
                                description: "Controller handles database models directly without a separate service layer",
                                file: null,
                                method: null,
                                verified: false
                            },
                            dataAccess: {
                                models: databaseModels.length > 0 ? [...new Set(databaseModels)] : [],
                                orm: databaseModels.length > 0 ? "Prisma" : null,
                                verified: databaseModels.length > 0
                            }
                        };

                        const behaviorEvidence = {
                            pathParams: params.length > 0 ? params : [],
                            queryParams: queryParams || [],
                            bodyParams: requestBodySchema || [],
                            responseStatusCodes: responseStatusCodes && responseStatusCodes.length > 0 ? responseStatusCodes : [200],
                            inferredResponseStatusCodes: responseStatusCodes && responseStatusCodes.length > 0 ? responseStatusCodes : [200],
                            errorHandling: errorHandling || { hasTryCatch: false, callsNext: false },
                        };

                        const verification = {
                            source: {
                                status: "FOUND_IN_SOURCE",
                                description: `Route definition confirmed in ${routeFile.path} at line ${sourceLineStart}`,
                                detectionType: "AST",
                                sourceFile: routeFile.path,
                                sourceLine: sourceLineStart,
                            },
                            runtime: {
                                status: "NOT_EXECUTED",
                                description: "No runtime test execution evidence recorded yet",
                                executedCount: 0,
                                passedCount: 0,
                                failedCount: 0,
                            },
                            contract: {
                                status: "CONTRACT_UNVERIFIED",
                                description: "No independent API contract specification (e.g. OpenAPI/Swagger spec) was provided in this project snapshot",
                                contractSource: null,
                            }
                        };

                        endpoints.push({
                            method,
                            path: fullPath || "/",
                            fullPath: fullPath || "/",
                            sourceFile: routeFile.path,
                            sourceLine: sourceLineStart,
                            sourceLineStart,
                            sourceLineEnd,
                            routeSnippet: routeSnippet.trim(),
                            controllerFile,
                            controllerLine,
                            controllerLineStart,
                            controllerLineEnd,
                            controllerMethod,
                            controllerSnippet,
                            middleware: rawMiddlewareNames.length > 0 ? rawMiddlewareNames : undefined,
                            middlewares: resolvedMiddlewares,
                            params: params.length > 0 ? params : undefined,
                            queryParams: queryParams && queryParams.length > 0 ? queryParams : undefined,
                            requestBodySchema,
                            databaseModels: databaseModels.length > 0 ? [...new Set(databaseModels)] : undefined,
                            responseStatusCodes,
                            errorHandling,
                            requestProcessingChain,
                            behaviorEvidence,
                            verification,
                            provenance: {
                                detectionType: "AST_FALLBACK",
                                sourceFile: routeFile.path,
                                sourceLine: sourceLineStart,
                                sourceLineEnd,
                                resolutionStatus: "FULLY_RESOLVED"

                            }
                        });
                    }
                }
            });
        }
    }

    // Direct app.get/post endpoints via regex fallback
    const appFiles = sourceFiles.filter(
        (f) => f.path.includes("app.js") || f.path.includes("index.js") || f.path.includes("server.js")
    );
    for (const file of appFiles) {
        const directRouteRegex = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
        let match;
        while ((match = directRouteRegex.exec(file.content)) !== null) {
            const upToMatch = file.content.substring(0, match.index);
            const lineMatch = upToMatch.match(/\n/g);
            const sourceLine = lineMatch ? lineMatch.length + 1 : 1;
            const fullPath = match[2];
            const method = match[1].toUpperCase();

            const params = [];
            const paramRegex = /:([a-zA-Z0-9_]+)/g;
            let pMatch;
            while ((pMatch = paramRegex.exec(fullPath)) !== null) {
                params.push(pMatch[1]);
            }

            const rLines = file.content.split('\n');
            const routeSnippet = rLines[sourceLine - 1] || match[0];

            const requestProcessingChain = {
                routeRegistration: {
                    mountPrefix: "",
                    mountFile: file.path,
                    mountLine: sourceLine,
                    sourceFile: file.path,
                    sourceLineStart: sourceLine,
                    sourceLineEnd: sourceLine,
                    routeSnippet: routeSnippet.trim(),
                    method,
                    path: fullPath,
                    verified: true
                },
                middlewares: [],
                controller: {
                    name: "inlineHandler",
                    file: file.path,
                    lineStart: sourceLine,
                    lineEnd: sourceLine,
                    snippet: routeSnippet.trim(),
                    verified: true
                },
                service: {
                    status: "DIRECT_CONTROLLER",
                    description: "Inline route handler without separate service layer",
                    file: null,
                    method: null,
                    verified: false
                },
                dataAccess: {
                    models: [],
                    orm: null,
                    verified: false
                }
            };

            const behaviorEvidence = {
                pathParams: params,
                queryParams: [],
                bodyParams: [],
                responseStatusCodes: [200],
                errorHandling: { hasTryCatch: false, callsNext: false },
            };

            const verification = {
                source: {
                    status: "FOUND_IN_SOURCE",
                    description: `Direct route confirmed in ${file.path} at line ${sourceLine}`,
                    detectionType: "REGEX_FALLBACK",
                    sourceFile: file.path,
                    sourceLine: sourceLine,
                },
                runtime: {
                    status: "NOT_EXECUTED",
                    description: "No runtime test execution evidence recorded yet",
                    executedCount: 0,
                    passedCount: 0,
                    failedCount: 0,
                },
                contract: {
                    status: "CONTRACT_UNVERIFIED",
                    description: "No independent API contract specification (e.g. OpenAPI/Swagger spec) was provided in this project snapshot",
                    contractSource: null,
                }
            };

            endpoints.push({
                method,
                path: fullPath,
                fullPath,
                sourceFile: file.path,
                sourceLine,
                sourceLineStart: sourceLine,
                sourceLineEnd: sourceLine,
                routeSnippet: routeSnippet.trim(),
                controllerFile: null,
                controllerLine: null,
                params: params.length > 0 ? params : undefined,
                requestProcessingChain,
                behaviorEvidence,
                verification,
                provenance: {
                    detectionType: "AST_FALLBACK",
                    sourceFile: file.path,
                    sourceLine: sourceLine,
                    sourceLineEnd: sourceLine,
                    resolutionStatus: "PARTIALLY_RESOLVED"
                }
            });
        }
    }

    // Deduplicate based on method + fullPath
    const uniqueEndpointsMap = new Map();
    for (const ep of endpoints) {
        const key = `${ep.method}:${ep.path || ep.fullPath}`;
        if (!uniqueEndpointsMap.has(key)) {
            uniqueEndpointsMap.set(key, ep);
        }
    }

    return Array.from(uniqueEndpointsMap.values());
};
