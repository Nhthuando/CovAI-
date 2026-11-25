import { expect, it, jest } from "@jest/globals";

const snapshotId = "snap-1";
const servicePath = "server/services/productService.js";
const routePath = "server/routes/cartRoutes.js";
const coverageFunction = {
  findMany: jest.fn().mockResolvedValue([{ filePath: servicePath }, { filePath: routePath }]),
  deleteMany: jest.fn(),
  createMany: jest.fn(),
};

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: {
    projectSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: snapshotId }) },
    $transaction: jest.fn(async (run) => run({ coverageFunction })),
  },
}));

jest.unstable_mockModule("../services/projectAccess.service.js", () => ({
  resolveProjectAccess: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule("../services/projectOperationWorkspace.service.js", () => ({
  operationSnapshot: (snapshot) => snapshot,
  currentProjectOperation: () => null,
  stagePreparedPublication: jest.fn(),
}));

const { parseCoverageFunctionsForSnapshot } = await import("../services/coverageFunctionParser.service.js");

it("preserves existing business-logic functions while replacing integration route functions", async () => {
  const routeFunction = { functionName: "getCart", startLine: 3, endLine: 5, hit: 2 };
  await parseCoverageFunctionsForSnapshot({
    projectId: "proj-1",
    snapshotId,
    userId: "user-1",
    preserveUnitRows: true,
    coverageReport: {
      [servicePath]: { functions: [{ name: "getProduct", hit: 1 }] },
      [routePath]: { functions: [{ name: routeFunction.functionName, ...routeFunction }] },
    },
  });

  expect(coverageFunction.deleteMany).toHaveBeenCalledTimes(1);
  expect(coverageFunction.deleteMany).toHaveBeenCalledWith({
    where: { snapshotId, filePath: { in: [routePath] } },
  });
  expect(coverageFunction.createMany).toHaveBeenCalledTimes(1);
  expect(coverageFunction.createMany).toHaveBeenCalledWith({
    data: [{ snapshotId, filePath: routePath, ...routeFunction }],
    skipDuplicates: true,
  });
});
