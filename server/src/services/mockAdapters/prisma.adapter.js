import { buildFixtureRecord, buildOperationFixtures, buildReturnValueFromContract } from "./fixtureBuilder.js";

function groupByModel(contracts = []) {
    const models = new Map();
    for (const c of contracts) {
        const parts = String(c.clientOrModel || "").split(".");
        const modelName = parts.length >= 2 ? parts[1] : null;
        if (!modelName || modelName.startsWith("$")) continue;
        if (!models.has(modelName)) models.set(modelName, []);
        models.get(modelName).push(c);
    }
    return models;
}

export const prismaAdapter = {
    name: "prisma",
    priority: 100,

    canHandle({ dependency, contracts = [], technologyReport }) {
        const src = dependency?.source || "";
        if (src === "@prisma/client" || /prisma/i.test(src)) return true;
        if (technologyReport?.technologies?.prisma?.detectedInSource) {
            return contracts.some((c) =>
                ["findUnique", "findFirst", "findMany", "createMany", "updateMany", "deleteMany", "upsert", "aggregate", "groupBy", "$transaction"].includes(c.method)
            );
        }
        return false;
    },

    generateMock({ dependency, contracts = [], framework = "jest", assertionFields = [] }) {
        const isVitest = framework === "vitest";
        const fn = isVitest ? "vi.fn" : "jest.fn";
        const mockApi = isVitest ? "vi.mock" : "jest.mock";
        const importSource = dependency?.source || "@prisma/client";
        const byModel = groupByModel(contracts);
        const fixtures = {};
        const modelBlocks = [];

        for (const [modelName, modelContracts] of byModel.entries()) {
            const opFixtures = buildOperationFixtures(modelContracts, { assertionFields });
            const rec = opFixtures.find;
            fixtures[modelName] = opFixtures;
            const methods = new Map();
            for (const c of modelContracts) {
                const kindRec = opFixtures[c.operationKind] || rec;
                const val = buildReturnValueFromContract(c, kindRec);
                const valJson = JSON.stringify(val ?? kindRec);
                if (["create", "update", "upsert"].includes(c.method)) {
                    const persistedRec = c.operationKind === "update" ? opFixtures.update : opFixtures.create;
                    methods.set(
                        c.method,
                        `${c.method}: ${fn}((args) => Promise.resolve({ ...${JSON.stringify(persistedRec)}, ...(args?.data || args?.create || args?.update || {}) }))`
                    );
                } else {
                    methods.set(c.method, `${c.method}: ${fn}().mockResolvedValue(${valJson})`);
                }
            }
            for (const [stdMethod, defExpr] of [
                ["findMany", `findMany: ${fn}().mockResolvedValue([${JSON.stringify(opFixtures.find)}])`],
                ["findUnique", `findUnique: ${fn}().mockResolvedValue(${JSON.stringify(opFixtures.find)})`],
                ["findFirst", `findFirst: ${fn}().mockResolvedValue(${JSON.stringify(opFixtures.find)})`],
                ["count", `count: ${fn}().mockResolvedValue(1)`],
            ]) {
                if (!methods.has(stdMethod)) methods.set(stdMethod, defExpr);
            }
            modelBlocks.push(`    ${modelName}: {\n      ${Array.from(methods.values()).join(",\n      ")}\n    }`);
        }

        const defaultRecord = buildFixtureRecord(contracts, { assertionFields });
        const factoryBody =
            `  const defaultRecord = ${JSON.stringify(defaultRecord)};\n` +
            `  const createModelMock = () => new Proxy({\n` +
            `    findUnique: ${fn}().mockResolvedValue(defaultRecord),\n` +
            `    findFirst: ${fn}().mockResolvedValue(defaultRecord),\n` +
            `    findMany: ${fn}().mockResolvedValue([defaultRecord]),\n` +
            `    create: ${fn}((args) => Promise.resolve({ ...defaultRecord, ...(args?.data || {}) })),\n` +
            `    update: ${fn}((args) => Promise.resolve({ ...defaultRecord, ...(args?.data || {}) })),\n` +
            `    upsert: ${fn}((args) => Promise.resolve({ ...defaultRecord, ...(args?.create || args?.update || {}) })),\n` +
            `    delete: ${fn}().mockResolvedValue(defaultRecord),\n` +
            `    count: ${fn}().mockResolvedValue(1),\n` +
            `  }, {\n` +
            `    get(target, prop) {\n` +
            `      if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
            `      if (prop in target) return target[prop];\n` +
            `      target[prop] = ${fn}().mockResolvedValue(defaultRecord);\n` +
            `      return target[prop];\n` +
            `    }\n` +
            `  });\n` +
            `  const modelsMap = new Map();\n` +
            `  const explicitModels = {\n${modelBlocks.join(",\n")}\n  };\n` +
            `  const prismaClient = new Proxy({\n` +
            `    ...explicitModels,\n` +
            `    $transaction: ${fn}(async (arg) => Array.isArray(arg) ? Promise.all(arg) : arg(prismaClient)),\n` +
            `    $connect: ${fn}().mockResolvedValue(undefined),\n` +
            `    $disconnect: ${fn}().mockResolvedValue(undefined),\n` +
            `  }, {\n` +
            `    get(target, prop) {\n` +
            `      if (prop in target) return target[prop];\n` +
            `      if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch') return undefined;\n` +
            `      if (!modelsMap.has(prop)) modelsMap.set(prop, createModelMock());\n` +
            `      return modelsMap.get(prop);\n` +
            `    }\n` +
            `  });\n`;

        let mockCode;
        if (importSource === "@prisma/client") {
            mockCode = isVitest
                ? `${mockApi}('${importSource}', () => {\n${factoryBody}  return { PrismaClient: ${fn}(() => prismaClient), default: prismaClient };\n});`
                : `${mockApi}('${importSource}', () => {\n${factoryBody}  return { PrismaClient: ${fn}(() => prismaClient), default: prismaClient };\n});`;
        } else {
            mockCode = `${mockApi}('${importSource}', () => {\n${factoryBody}  return { default: prismaClient, prisma: prismaClient, db: prismaClient };\n});`;
        }

        return {
            status: "GENERATED",
            adapter: "prisma",
            mockCode,
            fixtures,
            diagnostics: [],
        };
    },
};
