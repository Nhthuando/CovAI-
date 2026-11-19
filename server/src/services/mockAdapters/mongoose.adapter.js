import { buildFixtureRecord, buildReturnValueFromContract } from "./fixtureBuilder.js";

const QUERY_METHODS = new Set([
    "find", "findOne", "findById", "findOneAndUpdate", "findByIdAndUpdate",
    "findOneAndDelete", "findByIdAndDelete", "findOneAndReplace", "findByIdAndRemove",
    "findOneAndRemove", "countDocuments", "estimatedDocumentCount", "exists",
    "deleteOne", "deleteMany", "updateOne", "updateMany", "replaceOne",
    "aggregate", "distinct",
]);

function makeChainableHelper(fn) {
    return (
        `  const createChainableQuery = (resolvedValue) => {\n` +
        `    const query = {\n` +
        `      populate: ${fn}(() => query),\n` +
        `      sort: ${fn}(() => query),\n` +
        `      limit: ${fn}(() => query),\n` +
        `      skip: ${fn}(() => query),\n` +
        `      select: ${fn}(() => query),\n` +
        `      where: ${fn}(() => query),\n` +
        `      equals: ${fn}(() => query),\n` +
        `      lean: ${fn}(() => query),\n` +
        `      session: ${fn}(() => query),\n` +
        `      distinct: ${fn}(() => query),\n` +
        `      or: ${fn}(() => query),\n` +
        `      and: ${fn}(() => query),\n` +
        `      collation: ${fn}(() => query),\n` +
        `      hint: ${fn}(() => query),\n` +
        `      exec: ${fn}(() => Promise.resolve(resolvedValue)),\n` +
        `      then: (onFulfilled, onRejected) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected),\n` +
        `      catch: (onRejected) => Promise.resolve(resolvedValue).catch(onRejected),\n` +
        `      finally: (cb) => Promise.resolve(resolvedValue).finally(cb),\n` +
        `    };\n` +
        `    return query;\n` +
        `  };\n`
    );
}

export const mongooseAdapter = {
    name: "mongoose",
    priority: 95,

    canHandle({ dependency, contracts = [], technologyReport }) {
        const src = dependency?.source || "";
        if (src === "mongoose") return true;
        if (technologyReport?.technologies?.mongoose?.detectedInSource) {
            const hasMongooseCall = contracts.some((c) =>
                QUERY_METHODS.has(c.method) ||
                c.chainedMethods?.some((m) => ["populate", "lean", "exec", "sort", "select"].includes(m))
            );
            if (hasMongooseCall) return true;
        }
        return false;
    },

    generateMock({ dependency, contracts = [], framework = "jest" }) {
        const isVitest = framework === "vitest";
        const fn = isVitest ? "vi.fn" : "jest.fn";
        const mockApi = isVitest ? "vi.mock" : "jest.mock";
        const importSource = dependency?.source || "mongoose";
        const rec = buildFixtureRecord(contracts);

        const methods = new Map();
        for (const c of contracts) {
            const val = buildReturnValueFromContract(c, rec);
            const valJson = JSON.stringify(val ?? rec);
            if (QUERY_METHODS.has(c.method) || (c.chainedMethods && c.chainedMethods.length > 0)) {
                methods.set(c.method, `${c.method}: ${fn}(() => createChainableQuery(${valJson}))`);
            } else if (c.method === "create" || c.method === "insertMany") {
                methods.set(
                    c.method,
                    `${c.method}: ${fn}((doc) => Promise.resolve(Array.isArray(doc) ? doc.map((d) => ({ ...${JSON.stringify(rec)}, ...d })) : { ...${JSON.stringify(rec)}, ...(doc || {}) }))`
                );
            } else {
                methods.set(c.method, `${c.method}: ${fn}().mockResolvedValue(${valJson})`);
            }
        }

        // Ensure standard Mongoose model methods exist
        if (!methods.has("find")) methods.set("find", `find: ${fn}(() => createChainableQuery([${JSON.stringify(rec)}]))`);
        if (!methods.has("findById")) methods.set("findById", `findById: ${fn}(() => createChainableQuery(${JSON.stringify(rec)}))`);
        if (!methods.has("findOne")) methods.set("findOne", `findOne: ${fn}(() => createChainableQuery(${JSON.stringify(rec)}))`);
        if (!methods.has("create")) methods.set("create", `create: ${fn}((doc) => Promise.resolve({ ...${JSON.stringify(rec)}, ...(doc || {}) }))`);
        if (!methods.has("countDocuments")) methods.set("countDocuments", `countDocuments: ${fn}(() => createChainableQuery(1))`);
        if (!methods.has("deleteOne")) methods.set("deleteOne", `deleteOne: ${fn}(() => createChainableQuery({ deletedCount: 1, acknowledged: true }))`);
        if (!methods.has("deleteMany")) methods.set("deleteMany", `deleteMany: ${fn}(() => createChainableQuery({ deletedCount: 1, acknowledged: true }))`);
        if (!methods.has("updateOne")) methods.set("updateOne", `updateOne: ${fn}(() => createChainableQuery({ matchedCount: 1, modifiedCount: 1, acknowledged: true }))`);
        if (!methods.has("updateMany")) methods.set("updateMany", `updateMany: ${fn}(() => createChainableQuery({ matchedCount: 1, modifiedCount: 1, acknowledged: true }))`);
        if (!methods.has("exists")) methods.set("exists", `exists: ${fn}(() => createChainableQuery({ _id: '507f1f77bcf86cd799439011' }))`);
        if (!methods.has("aggregate")) methods.set("aggregate", `aggregate: ${fn}(() => createChainableQuery([${JSON.stringify(rec)}]))`);
        if (!methods.has("distinct")) methods.set("distinct", `distinct: ${fn}(() => createChainableQuery(['sample']))`);

        const methodEntries = Array.from(methods.values()).join(",\n    ");
        const modelFactory =
            `  const modelMock = Object.assign(\n` +
            `    ${fn}(function (data) { const inst = { ...${JSON.stringify(rec)}, ...(data || {}) }; inst.save = ${fn}().mockResolvedValue(inst); inst.validate = ${fn}().mockResolvedValue(undefined); inst.validateSync = ${fn}(() => undefined); inst.toObject = ${fn}(() => ({ ...inst })); inst.toJSON = ${fn}(() => ({ ...inst })); return inst; }),\n` +
            `    {\n    ${methodEntries}\n    }\n` +
            `  );\n`;

        let mockCode;
        if (importSource === "mongoose") {
            mockCode =
                `${mockApi}('mongoose', () => {\n` +
                makeChainableHelper(fn) +
                modelFactory +
                `  const Schema = ${fn}(function () { return { pre: ${fn}(), post: ${fn}(), index: ${fn}(), virtual: ${fn}(() => ({ get: ${fn}() })) }; });\n` +
                `  Schema.Types = { ObjectId: String, Mixed: Object };\n` +
                `  const mongooseMock = {\n` +
                `    Schema,\n` +
                `    model: ${fn}(() => modelMock),\n` +
                `    models: {},\n` +
                `    Types: { ObjectId: ${fn}((id) => id || '507f1f77bcf86cd799439011') },\n` +
                `    connect: ${fn}().mockResolvedValue(undefined),\n` +
                `    disconnect: ${fn}().mockResolvedValue(undefined),\n` +
                `  };\n` +
                `  return { default: mongooseMock, ...mongooseMock };\n` +
                `});`;
        } else if (!isVitest) {
            const namedBindings = (dependency?.bindings || [])
                .map(b => b.importedName)
                .filter(n => n && n !== "default" && n !== "*");
            const attachLines = [
                `  modelMock.default = modelMock;`,
                ...namedBindings.map(n => `  modelMock[${JSON.stringify(n)}] = modelMock;`)
            ].join("\n");
            mockCode =
                `${mockApi}('${importSource}', () => {\n` +
                makeChainableHelper(fn) +
                modelFactory +
                `${attachLines}\n` +
                `  return modelMock;\n` +
                `});`;
        } else {
            const namedBindings = (dependency?.bindings || [])
                .map(b => b.importedName)
                .filter(n => n && n !== "default" && n !== "*");
            const namedProps = namedBindings.map(n => `, ${n}: modelMock`).join("");
            mockCode =
                `${mockApi}('${importSource}', () => {\n` +
                makeChainableHelper(fn) +
                modelFactory +
                `  return { default: modelMock${namedProps} };\n` +
                `});`;
        }

        return {
            status: "GENERATED",
            adapter: "mongoose",
            mockCode,
            fixtures: { default: rec },
            diagnostics: [],
        };
    },
};
