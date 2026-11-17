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
        const exportProps = new Map();
        const nestedTargetMethods = new Map();

        for (const c of contracts) {
            const val = buildReturnValueFromContract(c, rec);
            const valJson = val === undefined ? "undefined" : JSON.stringify(val);
            const isMethodOnObject = c.clientOrModel && c.clientOrModel.includes(".")
                ? true
                : bindings.some((b) => b.localName === c.dependencyRoot && (b.importedName === "default" || b.importedName === "*"));

            if (isMethodOnObject && c.method !== c.dependencyRoot) {
                nestedTargetMethods.set(c.method, formatMockFn(framework, valJson, c.isAsync));
            } else {
                exportProps.set(c.method, formatMockFn(framework, valJson, c.isAsync));
            }
        }

        // Ensure every named import binding exists on the mock module to prevent MOCK_MISSING_EXPORT
        for (const b of bindings) {
            if (b.importedName && b.importedName !== "default" && b.importedName !== "*" && !exportProps.has(b.importedName)) {
                if (nestedTargetMethods.size > 0) {
                    const nestedLines = Array.from(nestedTargetMethods.entries()).map(([k, v]) => `    ${k}: ${v}`).join(",\n");
                    exportProps.set(b.importedName, `{\n${nestedLines}\n  }`);
                } else {
                    exportProps.set(b.importedName, `${fn}()`);
                }
            }
        }

        const lines = [];
        if (nestedTargetMethods.size > 0) {
            const nestedEntries = Array.from(nestedTargetMethods.entries()).map(([k, v]) => `    ${k}: ${v}`).join(",\n");
            lines.push(`  const defaultObj = {\n${nestedEntries}\n  };`);
        }
        const propEntries = Array.from(exportProps.entries()).map(([k, v]) => `    ${k}: ${v}`);
        if (nestedTargetMethods.size > 0) {
            propEntries.unshift(`    default: defaultObj`);
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

        const mockCode = `${mockApi}('${src}', () => ({\n${lines.length ? lines.join("\n") + "\n" : ""}${propEntries.join(",\n")}\n}));`;
        return {
            status: "GENERATED",
            adapter: "generic-repository",
            mockCode,
            fixtures: { default: rec },
            diagnostics: [],
        };
    },
};
