import { buildFixtureRecord, buildReturnValueFromContract, formatMockFn } from "./fixtureBuilder.js";

const KNOWN_HTTP_CLIENTS = new Set(["axios", "node-fetch", "undici", "got"]);
const KNOWN_REDIS_CLIENTS = new Set(["redis", "ioredis"]);
const KNOWN_NATIVE_DBS = new Set(["pg", "mysql", "mysql2", "mongodb", "sqlite3", "better-sqlite3", "knex"]);

export const genericRepositoryAdapter = {
    name: "generic-repository",
    priority: 10,

    canHandle({ dependency, contracts = [] }) {
        const src = dependency?.source || "";
        if (src.startsWith(".")) return true;
        if (KNOWN_HTTP_CLIENTS.has(src) || KNOWN_REDIS_CLIENTS.has(src) || KNOWN_NATIVE_DBS.has(src)) return true;
        return contracts.length > 0;
    },

    generateMock({ dependency, contracts = [], framework = "jest" }) {
        const isVitest = framework === "vitest";
        const fn = isVitest ? "vi.fn" : "jest.fn";
        const mockApi = isVitest ? "vi.mock" : "jest.mock";
        const src = dependency?.source || "";

        // Unknown external package with no analyzable contracts -> refuse silent guessing
        if (!src.startsWith(".") && !KNOWN_HTTP_CLIENTS.has(src) && !KNOWN_REDIS_CLIENTS.has(src) && !KNOWN_NATIVE_DBS.has(src) && contracts.length === 0) {
            return {
                status: "UNSUPPORTED_DEPENDENCY",
                adapter: "generic-repository",
                mockCode: "",
                fixtures: {},
                diagnostics: [{
                    severity: "warning",
                    rule: "UNSUPPORTED_DEPENDENCY",
                    message: `External dependency '${src}' has no known adapter and no analyzable call contracts.`,
                }],
            };
        }

        if (src === "axios") {
            const rec = buildFixtureRecord(contracts);
            const mockCode =
                `${mockApi}('axios', () => {\n` +
                `  const mockAxios = {\n` +
                `    get: ${fn}().mockResolvedValue({ data: ${JSON.stringify(rec)}, status: 200 }),\n` +
                `    post: ${fn}().mockResolvedValue({ data: ${JSON.stringify(rec)}, status: 201 }),\n` +
                `    put: ${fn}().mockResolvedValue({ data: ${JSON.stringify(rec)}, status: 200 }),\n` +
                `    patch: ${fn}().mockResolvedValue({ data: ${JSON.stringify(rec)}, status: 200 }),\n` +
                `    delete: ${fn}().mockResolvedValue({ data: {}, status: 200 }),\n` +
                `    create: ${fn}(() => mockAxios),\n` +
                `  };\n` +
                `  return { default: mockAxios, ...mockAxios };\n` +
                `});`;
            return { status: "GENERATED", adapter: "generic-repository", mockCode, fixtures: { default: rec }, diagnostics: [] };
        }

        if (KNOWN_REDIS_CLIENTS.has(src)) {
            const mockCode =
                `${mockApi}('${src}', () => {\n` +
                `  const client = {\n` +
                `    get: ${fn}().mockResolvedValue(null),\n` +
                `    set: ${fn}().mockResolvedValue('OK'),\n` +
                `    del: ${fn}().mockResolvedValue(1),\n` +
                `    connect: ${fn}().mockResolvedValue(undefined),\n` +
                `    quit: ${fn}().mockResolvedValue('OK'),\n` +
                `  };\n` +
                `  return { default: ${fn}(() => client), createClient: ${fn}(() => client) };\n` +
                `});`;
            return { status: "GENERATED", adapter: "generic-repository", mockCode, fixtures: {}, diagnostics: [] };
        }

        // Local repository / service / native DB driver driven strictly by AST contracts
        const rec = buildFixtureRecord(contracts);
        const bindings = dependency?.bindings || [];

        const insertPathIntoTree = (tree, parts, leafCode) => {
            if (!parts.length) return;
            let cursor = tree;
            for (let i = 0; i < parts.length - 1; i++) {
                const seg = parts[i];
                if (!cursor[seg] || typeof cursor[seg] === "string") {
                    cursor[seg] = {};
                }
                cursor = cursor[seg];
            }
            const last = parts[parts.length - 1];
            if (!cursor[last] || typeof cursor[last] !== "object") {
                cursor[last] = leafCode;
            }
        };

        const renderTree = (node, indent = 4) => {
            const pad = " ".repeat(indent);
            const entries = Object.entries(node).map(([k, v]) => {
                const keyCode = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
                if (typeof v === "string") {
                    return `${pad}${keyCode}: ${v}`;
                }
                return `${pad}${keyCode}: {\n${renderTree(v, indent + 2)}\n${pad}}`;
            });
            return entries.join(",\n");
        };

        const buildContractFnCode = (c, valJson) => {
            if (Array.isArray(c.chainedMethods) && c.chainedMethods.length > 0) {
                const chainEntries = c.chainedMethods
                    .filter(m => !["exec", "then", "catch", "finally"].includes(m))
                    .map(m => `${m}: ${fn}(() => query)`).join(", ");
                const queryParts = chainEntries ? `${chainEntries}, ` : "";
                return `${fn}(() => { const query = { ${queryParts}exec: ${fn}(() => Promise.resolve(${valJson})), then: (ok, err) => Promise.resolve(${valJson}).then(ok, err), catch: (err) => Promise.resolve(${valJson}).catch(err) }; return query; })`;
            }
            return formatMockFn(framework, valJson, c.isAsync);
        };

        const exportTree = {};
        const defaultTree = {};
        let hasConstructedRoot = false;
        let hasDirectCallRoot = false;

        for (const c of contracts) {
            const val = buildReturnValueFromContract(c, rec);
            const valJson = val === undefined ? "undefined" : JSON.stringify(val);
            const fnCode = buildContractFnCode(c, valJson);
            const root = c.dependencyRoot || "";
            const clientOrModel = c.clientOrModel || root;

            let subParts = [];
            if (clientOrModel && root && clientOrModel.startsWith(root + ".")) {
                subParts = clientOrModel.slice(root.length + 1).split(".").filter(Boolean);
            } else if (clientOrModel && clientOrModel !== root && !clientOrModel.includes(".")) {
                subParts = [];
            }

            const fullMemberPath = (c.method === root && subParts.length === 0)
                ? []
                : [...subParts, c.method].filter(Boolean);

            const matchingNamed = bindings.find(b =>
                b.importedName && b.importedName !== "default" && b.importedName !== "*" && b.localName === root
            );
            const isDefaultOrCjs = bindings.some(b =>
                (b.importedName === "default" || b.importedName === "*") &&
                (b.localName === root || fullMemberPath.length > 0)
            ) || (bindings.length === 0 && fullMemberPath.length > 0);

            if (matchingNamed) {
                if (matchingNamed.localName !== root) hasConstructedRoot = true;
                if (fullMemberPath.length === 0) {
                    exportTree[matchingNamed.importedName] = fnCode;
                } else {
                    insertPathIntoTree(exportTree, [matchingNamed.importedName, ...fullMemberPath], fnCode);
                }
            } else if (isDefaultOrCjs || subParts.length > 0) {
                if (bindings.some(b => b.localName && root && b.localName !== root)) {
                    hasConstructedRoot = true;
                }
                if (fullMemberPath.length === 0) {
                    hasDirectCallRoot = true;
                } else {
                    insertPathIntoTree(defaultTree, fullMemberPath, fnCode);
                }
            } else if (c.method) {
                exportTree[c.method] = fnCode;
            }
        }

        const hasNestedDefault = Object.keys(defaultTree).length > 0;
        // Ensure every named import binding exists on the mock module to prevent MOCK_MISSING_EXPORT
        for (const b of bindings) {
            if (b.importedName && b.importedName !== "default" && b.importedName !== "*" && !(b.importedName in exportTree)) {
                if (hasNestedDefault) {
                    exportTree[b.importedName] = { ...defaultTree };
                } else {
                    exportTree[b.importedName] = `${fn}()`;
                }
            }
        }

        const lines = [];
        const propEntries = [];

        if (hasNestedDefault || hasConstructedRoot || hasDirectCallRoot) {
            const innerObjLiteral = hasNestedDefault ? `{\n${renderTree(defaultTree, 4)}\n  }` : `{}`;
            if (hasConstructedRoot) {
                lines.push(`  const innerObj = ${innerObjLiteral};`);
                lines.push(`  const defaultObj = Object.assign(${fn}(function () { return innerObj; }), innerObj);`);
            } else if (hasDirectCallRoot && !hasNestedDefault) {
                lines.push(`  const defaultObj = ${fn}().mockResolvedValue(${JSON.stringify(rec)});`);
            } else {
                lines.push(`  const defaultObj = ${innerObjLiteral};`);
            }
            propEntries.push(`    default: defaultObj`);
            for (const topKey of Object.keys(defaultTree)) {
                if (!(topKey in exportTree)) {
                    const keyCode = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(topKey) ? topKey : JSON.stringify(topKey);
                    propEntries.push(`    ${keyCode}: defaultObj[${JSON.stringify(topKey)}]`);
                }
            }
        }

        if (Object.keys(exportTree).length > 0) {
            propEntries.push(renderTree(exportTree, 4));
        }

        if (propEntries.length === 0) {
            return {
                status: "UNSUPPORTED_DEPENDENCY",
                adapter: "generic-repository",
                mockCode: "",
                fixtures: {},
                diagnostics: [{
                    severity: "warning",
                    rule: "UNSUPPORTED_DEPENDENCY",
                    message: `Dependency '${src}' has no analyzable methods or bindings to mock safely.`,
                }],
            };
        }

        // CommonJS sources load Jest mocks through require(), which returns the factory result as-is.
        // When the source constructs or calls the module root (e.g. `new Razorpay(...)`), the module itself must be
        // callable, so expose the callable default with the named members attached instead of a plain namespace object.
        const callableCjsRoot = !isVitest && (hasConstructedRoot || hasDirectCallRoot);
        const mockCode = callableCjsRoot
            ? `${mockApi}('${src}', () => {\n${lines.join("\n")}\n  return Object.assign(defaultObj, {\n${propEntries.join(",\n")}\n  });\n});`
            : `${mockApi}('${src}', () => {\n${lines.length ? lines.join("\n") + "\n" : ""}  return {\n${propEntries.join(",\n")}\n  };\n});`;
        return {
            status: "GENERATED",
            adapter: "generic-repository",
            mockCode,
            fixtures: { default: rec },
            diagnostics: [],
        };
    },
};
