import { buildFixtureRecord, buildReturnValueFromContract } from "./fixtureBuilder.js";

export const typeormAdapter = {
    name: "typeorm",
    priority: 88,

    canHandle({ dependency, contracts = [], technologyReport }) {
        const src = dependency?.source || "";
        if (src === "typeorm") return true;
        if (technologyReport?.technologies?.typeorm?.detectedInSource) {
            return contracts.some((c) =>
                ["createQueryBuilder", "getRepository", "getMany", "getOne", "getManyAndCount"].includes(c.method) ||
                c.chainedMethods?.some((m) => ["leftJoinAndSelect", "innerJoinAndSelect", "where", "andWhere", "getMany", "getOne"].includes(m))
            );
        }
        return false;
    },

    generateMock({ dependency, contracts = [], framework = "jest" }) {
        const isVitest = framework === "vitest";
        const fn = isVitest ? "vi.fn" : "jest.fn";
        const mockApi = isVitest ? "vi.mock" : "jest.mock";
        const importSource = dependency?.source || "typeorm";
        const rec = buildFixtureRecord(contracts);

        const hasSingle = contracts.some((c) => c.chainedMethods?.includes("getOne") || c.method === "findOne" || c.method === "findOneBy");
        const manyJson = JSON.stringify([rec]);
        const oneJson = JSON.stringify(rec);

        const qbFactory =
            `  const createQueryBuilderMock = () => {\n` +
            `    const qb = {\n` +
            `      select: ${fn}(() => qb),\n` +
            `      addSelect: ${fn}(() => qb),\n` +
            `      where: ${fn}(() => qb),\n` +
            `      andWhere: ${fn}(() => qb),\n` +
            `      orWhere: ${fn}(() => qb),\n` +
            `      leftJoinAndSelect: ${fn}(() => qb),\n` +
            `      innerJoinAndSelect: ${fn}(() => qb),\n` +
            `      orderBy: ${fn}(() => qb),\n` +
            `      skip: ${fn}(() => qb),\n` +
            `      take: ${fn}(() => qb),\n` +
            `      getMany: ${fn}().mockResolvedValue(${manyJson}),\n` +
            `      getOne: ${fn}().mockResolvedValue(${oneJson}),\n` +
            `      getCount: ${fn}().mockResolvedValue(1),\n` +
            `      getManyAndCount: ${fn}().mockResolvedValue([${manyJson}, 1]),\n` +
            `      execute: ${fn}().mockResolvedValue({ affected: 1 }),\n` +
            `    };\n` +
            `    return qb;\n` +
            `  };\n`;

        const repoMethods = new Map([
            ["find", `find: ${fn}().mockResolvedValue(${manyJson})`],
            ["findBy", `findBy: ${fn}().mockResolvedValue(${manyJson})`],
            ["findOne", `findOne: ${fn}().mockResolvedValue(${oneJson})`],
            ["findOneBy", `findOneBy: ${fn}().mockResolvedValue(${oneJson})`],
            ["save", `save: ${fn}((entity) => Promise.resolve({ ...${oneJson}, ...(entity || {}) }))`],
            ["create", `create: ${fn}((entity) => ({ ...${oneJson}, ...(entity || {}) }))`],
            ["delete", `delete: ${fn}().mockResolvedValue({ affected: 1 })`],
            ["count", `count: ${fn}().mockResolvedValue(1)`],
            ["createQueryBuilder", `createQueryBuilder: ${fn}(() => createQueryBuilderMock())`],
        ]);

        for (const c of contracts) {
            if (!repoMethods.has(c.method) && c.method !== "getRepository") {
                const val = buildReturnValueFromContract(c, rec);
                repoMethods.set(c.method, `${c.method}: ${fn}().mockResolvedValue(${JSON.stringify(val ?? (hasSingle ? rec : [rec]))})`);
            }
        }

        const repoBlock = `  const repositoryMock = {\n    ${Array.from(repoMethods.values()).join(",\n    ")}\n  };\n`;
        const mockCode = importSource === "typeorm"
            ? `${mockApi}('typeorm', () => {\n${qbFactory}${repoBlock}  return {\n    getRepository: ${fn}(() => repositoryMock),\n    DataSource: ${fn}(() => ({ getRepository: ${fn}(() => repositoryMock), initialize: ${fn}().mockResolvedValue(undefined) })),\n    Repository: class {},\n  };\n});`
            : `${mockApi}('${importSource}', () => {\n${qbFactory}${repoBlock}  return { default: repositoryMock, getRepository: ${fn}(() => repositoryMock) };\n});`;

        return {
            status: "GENERATED",
            adapter: "typeorm",
            mockCode,
            fixtures: { default: rec },
            diagnostics: [],
        };
    },
};
