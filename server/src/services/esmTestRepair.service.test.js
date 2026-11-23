import { describe, it, expect } from "@jest/globals";
import {
  buildEsmPrismaMockBlock,
  convertJestMocksAndStaticImportsToEsm,
  inspectModuleExportsAst,
  repairSupertestAppImport,
  resolveRelativeSpecifier,
} from "./esmTestRepair.service.js";
import { processSupertestTests } from "./supertestPostProcessor.service.js";
import { detectAppEntryContext, detectBackendSubdir } from "./supertestPromptBuilder.service.js";
import { extractSystemTestCode } from "./verifiedSystemGeneration.service.js";

describe("esmTestRepair & multi-level runtime execution fixes", () => {
  it("composes Express routers when backend index.js does not export app (e.g. export { io })", () => {
    const sourceCode = [
      {
        path: "server/src/index.js",
        content: `
          import express from "express";
          import http from "http";
          import eventRoutes from "./routes/event.routes.js";
          import statsRoutes from "./routes/stats.routes.js";
          const app = express();
          app.use(express.json());
          app.use(eventRoutes);
          app.use("/stats", statsRoutes);
          app.get("/", (req, res) => res.status(200).send("Server is running..."));
          const server = http.createServer(app);
          server.listen(5000);
          export { io };
        `,
      },
      {
        path: "server/src/routes/event.routes.js",
        content: `import express from "express"; export default express.Router();`,
      },
      {
        path: "server/src/routes/stats.routes.js",
        content: `import express from "express"; export default express.Router();`,
      },
      {
        path: "server/src/config/prisma.js",
        content: `import { PrismaClient } from "@prisma/client"; export default new PrismaClient();`,
      },
    ];

    const appCtx = detectAppEntryContext(sourceCode, []);
    expect(appCtx.testBaseDir).toBe("server/tests/integration");
    expect(appCtx.exportKind).toBe("COMPOSE_ROUTES");
    expect(appCtx.exportsApp).toBe(false);

    const rawResponse = JSON.stringify({
      suggestions: [],
      tests: [
        {
          filePath: "tests/integration/api.test.js",
          content: `
            import request from 'supertest';
            import app from '../../server/src/index.js';
            describe('API', () => {
              it('happy path: GET /', async () => {
                const res = await request(app).get('/');
                expect(res.status).toBe(200);
              });
            });
          `,
        },
      ],
    });

    const processed = processSupertestTests(rawResponse, {
      projectId: "proj-1",
      snapshotId: "snap-1",
      moduleType: "esm",
      sourceCode,
      backendSubdir: detectBackendSubdir(sourceCode, []),
    });

    expect(processed.allTests).toHaveLength(1);
    const out = processed.allTests[0];
    expect(out.filePath).toBe("server/tests/integration/api.test.js");
    expect(out.content).not.toContain("from '../../server/src/index.js'");
    expect(out.content).toContain("await import(\"../../src/routes/event.routes.js\")");
    expect(out.content).toContain("app.use(\"/stats\",");
    expect(out.content).toContain("await jest.unstable_mockModule('@prisma/client'");
    expect(out.content).toContain("await jest.unstable_mockModule(\"../../src/config/prisma.js\"");
  });

  it("rewrites default app import to named { app } import when entry uses named export", () => {
    const sourceCode = [
      {
        path: "src/app.js",
        content: `import express from "express"; export const app = express();`,
      },
    ];
    const code = `import request from 'supertest';\nimport app from '../../src/app.js';\ndescribe('a', () => {});`;
    const repaired = repairSupertestAppImport(code, {
      testFilePath: "tests/integration/a.test.js",
      moduleType: "esm",
      sourceCode,
    });
    expect(repaired).toContain(`import { app } from "../../src/app.js";`);
  });

  it("converts jest.mock + static imports to unstable_mockModule + dynamic await import and resolves relative paths in ESM", () => {
    const sourceCode = [
      {
        path: "server/src/controllers/article.controller.js",
        content: `import articleService from "../services/article.service.js"; export default {};`,
      },
      {
        path: "server/src/services/article.service.js",
        content: `import prisma from "../config/prisma.js"; export default {};`,
      },
      {
        path: "server/src/config/prisma.js",
        content: `import { PrismaClient } from "@prisma/client"; export default new PrismaClient();`,
      },
    ];

    const brokenUnit = `
      import { jest } from '@jest/globals';
      jest.mock('../../services/article.service', () => ({ getArticles: jest.fn() }), { virtual: true });
      import articleController from '../../src/controllers/article.controller';
      import articleService from '../../services/article.service';
      describe('ArticleController', () => {
        beforeEach(() => {
          req = { body: {} };
        });
        it('ok', () => expect(true).toBe(true));
      });
    `;

    const fixed = convertJestMocksAndStaticImportsToEsm(brokenUnit, {
      testFilePath: "server/tests/controllers/article.controller.test.js",
      sourceCode,
      targetSourceFile: "server/src/controllers/article.controller.js",
    });

    expect(fixed).toContain(`await jest.unstable_mockModule("../../src/services/article.service.js"`);
    expect(fixed).not.toContain(`virtual: true`);
    expect(fixed).toContain(`const { default: articleController } = await import("../../src/controllers/article.controller.js");`);
    expect(fixed).toContain(`const { default: articleService } = await import("../../src/services/article.service.js");`);
    expect(fixed).toContain(`let req;`);
    expect(fixed.indexOf("unstable_mockModule")).toBeLessThan(fixed.indexOf("await import"));
  });

  it("excludes SUT itself from relPrismaPaths when testing prisma.js", () => {
    const fixed = convertJestMocksAndStaticImportsToEsm(
      `import prisma from '../../src/config/prisma.js'; describe('p', () => { it('x', () => expect(prisma).toBeDefined()); });`,
      {
        testFilePath: "server/tests/config/prisma.test.js",
        sourceCode: [
          {
            path: "server/src/config/prisma.js",
            content: `import { PrismaClient } from "@prisma/client"; export default new PrismaClient();`,
          },
        ],
        targetSourceFile: "server/src/config/prisma.js",
        forcePrismaMock: true,
      },
    );
    expect(fixed).toContain("await jest.unstable_mockModule('@prisma/client'");
    expect(fixed).not.toContain(`await jest.unstable_mockModule("../../src/config/prisma.js"`);
  });

  it("repairs mistaken test.goto and test.locator calls in generated Playwright specs", () => {
    const raw = JSON.stringify({
      content: `import { test, expect } from '@playwright/test';
test.describe('App', () => {
  test('loads', async ({ page }) => {
    await test.goto('/');
    await expect(test.locator('h1')).toBeVisible();
  });
});`,
    });
    const repaired = extractSystemTestCode(raw);
    expect(repaired).toContain("await page.goto('/')");
    expect(repaired).toContain("page.locator('h1')");
    expect(repaired).not.toContain("test.goto(");
    expect(repaired).not.toContain("test.locator(");
  });

  it("resolves missing extensions and checks module exports cleanly", () => {
    const resolved = resolveRelativeSpecifier(
      "../../services/user.service",
      "server/tests/unit/user.test.js",
      [{ path: "server/src/services/user.service.js" }],
    );
    expect(resolved).toBe("../../src/services/user.service.js");

    const ast = inspectModuleExportsAst(`export const app = {};`, "app.js");
    expect(ast.hasDefaultExport).toBe(false);
    expect(ast.namedExports.has("app")).toBe(true);
    expect(buildEsmPrismaMockBlock(["../../src/config/prisma.js"])).toContain("unstable_mockModule");
  });
});
