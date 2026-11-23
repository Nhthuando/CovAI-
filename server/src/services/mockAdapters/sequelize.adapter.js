import { buildFixtureRecord, buildReturnValueFromContract } from "./fixtureBuilder.js";

export const sequelizeAdapter = {
    name: "sequelize",
    priority: 90,

    canHandle({ dependency, contracts = [], technologyReport }) {
        const src = dependency?.source || "";
        if (src === "sequelize" || src === "sequelize-typescript") return true;
        if (technologyReport?.technologies?.sequelize?.detectedInSource) {
            return contracts.some((c) => ["findAll", "findByPk", "bulkCreate", "destroy"].includes(c.method));
        }
        return false;
    },

    generateMock({ dependency, contracts = [], framework = "jest" }) {
        const isVitest = framework === "vitest";
        const fn = isVitest ? "vi.fn" : "jest.fn";
        const mockApi = isVitest ? "vi.mock" : "jest.mock";
        const importSource = dependency?.source || "sequelize";
        const rec = buildFixtureRecord(contracts);

        const methods = new Map();
        for (const c of contracts) {
            const val = buildReturnValueFromContract(c, rec);
            const valJson = JSON.stringify(val ?? rec);
            if (c.method === "create") {
                methods.set("create", `create: ${fn}((data) => Promise.resolve({ ...${JSON.stringify(rec)}, ...(data || {}), update: ${fn}().mockResolvedValue(true), destroy: ${fn}().mockResolvedValue(true) }))`);
            } else if (c.method === "update") {
                methods.set("update", `update: ${fn}().mockResolvedValue([1])`);
            } else if (c.method === "destroy") {
                methods.set("destroy", `destroy: ${fn}().mockResolvedValue(1)`);
            } else {
                methods.set(c.method, `${c.method}: ${fn}().mockResolvedValue(${valJson})`);
            }
        }
        if (!methods.has("findAll")) methods.set("findAll", `findAll: ${fn}().mockResolvedValue([${JSON.stringify(rec)}])`);
        if (!methods.has("findOne")) methods.set("findOne", `findOne: ${fn}().mockResolvedValue(${JSON.stringify(rec)})`);
        if (!methods.has("findByPk")) methods.set("findByPk", `findByPk: ${fn}().mockResolvedValue(${JSON.stringify(rec)})`);
        if (!methods.has("count")) methods.set("count", `count: ${fn}().mockResolvedValue(1)`);

        const methodEntries = Array.from(methods.values()).join(",\n    ");
        const modelBlock = `  const modelMock = {\n    ${methodEntries}\n  };\n`;

        const mockCode = importSource === "sequelize"
            ? `${mockApi}('sequelize', () => {\n${modelBlock}  const SequelizeMock = ${fn}(() => ({ define: ${fn}(() => modelMock), authenticate: ${fn}().mockResolvedValue(undefined), transaction: ${fn}((cb) => cb ? cb({}) : Promise.resolve({ commit: ${fn}(), rollback: ${fn}() })) }));\n  return { Sequelize: SequelizeMock, DataTypes: new Proxy({}, { get: () => String }), Model: class {}, default: SequelizeMock };\n});`
            : `${mockApi}('${importSource}', () => {\n${modelBlock}  return { default: modelMock };\n});`;

        return {
            status: "GENERATED",
            adapter: "sequelize",
            mockCode,
            fixtures: { default: rec },
            diagnostics: [],
        };
    },
};
