import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const mockPrisma = {
  projectSnapshot: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  project: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  projectMember: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  testRun: {
    findFirst: jest.fn(),
  },
  testScenario: {
    findFirst: jest.fn(),
  },
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
  default: mockPrisma,
}));

await jest.unstable_mockModule("../middlewares/auth.middleware.js", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: "user-sim-1", email: "sim@covai.dev" };
    next();
  },
}));

await jest.unstable_mockModule("../middlewares/projectEndpointPolicy.js", () => ({
  enforceProjectEndpointPolicy: () => (_req, _res, next) => next(),
}));

const {
  buildApiSimulationGraph,
  buildIntegrationScenarioTrace,
  extractScenarioHttpDetails,
} = await import("../services/integrationSimulationEngine.service.js");
const { extractValidEndpoints } = await import(
  "../services/apiEndpointParser.service.js"
);
const coverageRoute = (await import("../routes/coverage.route.js")).default;

const app = express();
app.use(express.json());
app.use("/api/coverage", coverageRoute);

const sampleSourceFiles = [
  {
    path: "src/app.js",
    content: `
      import express from "express";
      import orderRoutes from "./routes/order.routes.js";
      const app = express();
      app.use("/api/orders", orderRoutes);
      export default app;
    `,
  },
  {
    path: "src/middlewares/auth.middleware.js",
    content: `
      export function requireAuth(req, res, next) {
        if (!req.headers.authorization) return res.status(401).json({ message: "Unauthorized" });
        next();
      }
      export function validateOrderBody(req, res, next) {
        if (!req.body?.productId) return res.status(400).json({ message: "productId required" });
        next();
      }
    `,
  },
  {
    path: "src/routes/order.routes.js",
    content: `
      import express from "express";
      import { requireAuth, validateOrderBody } from "../middlewares/auth.middleware.js";
      import { createOrder, getOrderById } from "../controllers/order.controller.js";
      const router = express.Router();
      router.post("/", requireAuth, validateOrderBody, createOrder);
      router.get("/:id", requireAuth, getOrderById);
      export default router;
    `,
  },
  {
    path: "src/controllers/order.controller.js",
    content: `
      import orderService from "../services/order.service.js";
      export async function createOrder(req, res) {
        const { productId, qty } = req.body;
        if (!qty || qty <= 0) {
          return res.status(400).json({ message: "qty must be positive" });
        }
        const created = await orderService.createOrderRecord({ productId, qty });
        return res.status(201).json({ order: created });
      }
      export async function getOrderById(req, res) {
        const order = await orderService.findOrder(req.params.id);
        if (!order) return res.status(404).json({ message: "Order not found" });
        return res.status(200).json({ order });
      }
    `,
  },
  {
    path: "src/services/order.service.js",
    content: `
      import prisma from "../config/prisma.js";
      export default {
        async createOrderRecord(payload) {
          return prisma.order.create({ data: payload });
        },
        async findOrder(id) {
          return prisma.order.findUnique({ where: { id } });
        },
      };
    `,
  },
];

describe("Integration Simulation Engine (per-API code-driven graphs & shared scenario traces)", () => {
  const endpoints = extractValidEndpoints(sampleSourceFiles);
  const postOrderEndpoint = endpoints.find(
    (e) => e.method === "POST" && e.path === "/api/orders",
  );
  const getOrderEndpoint = endpoints.find(
    (e) => e.method === "GET" && e.path === "/api/orders/:id",
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds DISTINCT code-driven flow graphs for POST /api/orders vs GET /api/orders/:id", () => {
    expect(postOrderEndpoint).toBeDefined();
    expect(getOrderEndpoint).toBeDefined();

    const postGraph = buildApiSimulationGraph({
      endpoint: postOrderEndpoint,
      sourceFiles: sampleSourceFiles,
    });
    const getGraph = buildApiSimulationGraph({
      endpoint: getOrderEndpoint,
      sourceFiles: sampleSourceFiles,
    });

    // Different APIs must produce different diagrams matching their own code!
    expect(postGraph.nodes.map((n) => n.title)).not.toEqual(
      getGraph.nodes.map((n) => n.title),
    );
    expect(postGraph.nodes.some((n) => n.kind === "INPUT")).toBe(true);
    expect(postGraph.nodes.some((n) => n.title.includes("!qty || qty <= 0"))).toBe(true);
    expect(postGraph.nodes.some((n) => n.title === "prisma.order.create()")).toBe(true);

    expect(getGraph.nodes.some((n) => n.title === "prisma.order.findUnique()")).toBe(true);
    expect(getGraph.nodes.some((n) => n.title.includes("!order"))).toBe(true);
  });

  it("extracts headers, auth presence, payload, and expectedStatus from scenario code", () => {
    const details = extractScenarioHttpDetails(
      {
        code: `it("creates order", async () => {
          const res = await request(app)
            .post("/api/orders")
            .set("Authorization", "Bearer jwt-token")
            .send({ productId: "p1", qty: 2 });
          expect(res.status).toBe(201);
        });`,
      },
      postOrderEndpoint,
    );

    expect(details.hasAuthHeader).toBe(true);
    expect(details.payload).toEqual({ productId: "p1", qty: 2 });
    expect(details.expectedStatus).toBe(201);
  });

  it("reuses the SAME graph of POST /api/orders across Happy Path, Auth 401, Validation 400, and Recorded DB Failure", () => {
    const sharedGraph = buildApiSimulationGraph({
      endpoint: postOrderEndpoint,
      sourceFiles: sampleSourceFiles,
    });

    // 1. Happy Path 201
    const happyTrace = buildIntegrationScenarioTrace({
      endpoint: postOrderEndpoint,
      graph: sharedGraph,
      sourceFiles: sampleSourceFiles,
      scenario: {
        title: "should create order successfully (201)",
        expectedStatus: 201,
        code: `it("happy", async () => {
          const res = await request(app).post("/api/orders").set("Authorization", "Bearer abc").send({ productId: "p1", qty: 2 });
          expect(res.status).toBe(201);
        });`,
      },
    });

    expect(happyTrace.graph).toBe(sharedGraph);
    expect(happyTrace.mode).toBe("AST_SIMULATED");
    const happyTitles = happyTrace.activeNodeIds.map(
      (id) => sharedGraph.nodes.find((n) => n.id === id)?.title,
    );
    expect(happyTitles).toContain("requireAuth");
    expect(happyTitles).toContain("validateOrderBody");
    expect(happyTitles).toContain("prisma.order.create()");
    expect(happyTrace.outcome.actualStatus).toBe(201);

    // 2. Auth 401 stops at mw_0 (does NOT reach controller/service/database)
    const authTrace = buildIntegrationScenarioTrace({
      endpoint: postOrderEndpoint,
      graph: sharedGraph,
      sourceFiles: sampleSourceFiles,
      scenario: {
        title: "auth negative: should return 401 when missing Authorization token",
        expectedStatus: 401,
        code: `it("auth 401", async () => {
          const res = await request(app).post("/api/orders").send({ productId: "p1", qty: 2 });
          expect(res.status).toBe(401);
        });`,
      },
    });

    expect(authTrace.graph).toBe(sharedGraph);
    expect(authTrace.activeNodeIds).toEqual([
      "client",
      "router",
      "mw_0",
      "response",
      "assertion",
    ]);
    expect(authTrace.outcome.actualStatus).toBe(401);

    // 3. Validation 400 passes mw_0, stops at mw_1 (does NOT reach database)
    const validationTrace = buildIntegrationScenarioTrace({
      endpoint: postOrderEndpoint,
      graph: sharedGraph,
      sourceFiles: sampleSourceFiles,
      scenario: {
        title: "validation: should return 400 when productId missing",
        expectedStatus: 400,
        code: `it("val 400", async () => {
          const res = await request(app).post("/api/orders").set("Authorization", "Bearer abc").send({});
          expect(res.status).toBe(400);
        });`,
      },
    });

    expect(validationTrace.activeNodeIds).toEqual([
      "client",
      "router",
      "mw_0",
      "mw_1",
      "response",
      "assertion",
    ]);

    // 4. Recorded Failed Run (DATABASE_FAILURE)
    const dbFailureTrace = buildIntegrationScenarioTrace({
      endpoint: postOrderEndpoint,
      graph: sharedGraph,
      sourceFiles: sampleSourceFiles,
      scenario: {
        title: "should create order successfully (201)",
        status: "FAILED",
        expectedStatus: 201,
        actualStatus: 500,
        failureLayer: "DATABASE_FAILURE",
        duration: 42,
        code: `it("happy", async () => {
          const res = await request(app).post("/api/orders").set("Authorization", "Bearer abc").send({ productId: "p1", qty: 2 });
          expect(res.status).toBe(201);
        });`,
      },
    });

    expect(dbFailureTrace.mode).toBe("RECORDED");
    expect(dbFailureTrace.outcome.passed).toBe(false);
    expect(dbFailureTrace.outcome.failureLayer).toBe("DATABASE_FAILURE");
    const dbStep = dbFailureTrace.steps.find((s) => s.phase === "DATABASE");
    expect(dbStep?.status).toBe("ERROR");
  });

  it("traces 404 Not Found decision branch after database lookup for GET /api/orders/:id", () => {
    const graph = buildApiSimulationGraph({
      endpoint: getOrderEndpoint,
      sourceFiles: sampleSourceFiles,
    });

    const notFoundTrace = buildIntegrationScenarioTrace({
      endpoint: getOrderEndpoint,
      graph,
      sourceFiles: sampleSourceFiles,
      scenario: {
        title: "not found: should return 404 when order does not exist",
        expectedStatus: 404,
        code: `it("404", async () => {
          const res = await request(app).get("/api/orders/missing-id").set("Authorization", "Bearer abc");
          expect(res.status).toBe(404);
        });`,
      },
    });

    const decisionStep = notFoundTrace.steps.find((s) => s.phase === "BRANCH_DECISION");
    expect(decisionStep?.status).toBe("BLOCKED");
    expect(decisionStep?.branchEvaluation?.result).toContain("404");
    const dbStep = notFoundTrace.steps.find((s) => s.phase === "DATABASE");
    expect(dbStep?.dbOperation?.result).toBe("null / empty");
    expect(notFoundTrace.outcome.actualStatus).toBe(404);
  });

  it("serves POST /api/coverage/:snapshotId/integration/simulation/trace over HTTP", async () => {
    mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
      id: "snap-1",
      projectId: "proj-1",
      rootDir: null,
      storagePath: null,
      project: { id: "proj-1", ownerId: "user-sim-1" },
    });
    mockPrisma.testRun.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/coverage/snap-1/integration/simulation/trace")
      .send({
        method: "POST",
        path: "/api/orders",
        endpoint: postOrderEndpoint,
        sourceFiles: sampleSourceFiles,
        scenario: {
          title: "happy path 201",
          expectedStatus: 201,
          code: `it("happy", async () => {
            const res = await request(app).post("/api/orders").set("Authorization", "Bearer t").send({ productId: "x", qty: 1 });
            expect(res.status).toBe(201);
          });`,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.graph.endpointKey).toBe("POST /api/orders");
    expect(res.body.data.steps.length).toBeGreaterThanOrEqual(6);
  });

  it("returns 404 when snapshot does not exist", async () => {
    mockPrisma.projectSnapshot.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/coverage/missing-snap/integration/simulation/trace")
      .send({ method: "GET", path: "/api/orders" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
