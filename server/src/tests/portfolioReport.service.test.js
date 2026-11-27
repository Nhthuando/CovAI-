import { jest } from "@jest/globals";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  buildPortfolioReportDto,
  synthesizeDeterministicPortfolioFindings,
  sanitizeCsvCell,
  formatPortfolioReportCsv,
  formatPortfolioReportJson,
  buildPortfolioExportFilename,
} from "../services/portfolioReport.service.js";
import { renderPortfolioPdf } from "../services/portfolioPdf.service.js";
import { exportPortfolioReportController } from "../controllers/portfolio.controller.js";
import prisma from "../config/prisma.js";

async function extractPdfLayoutPages(pdfBuffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
      .map((it) => {
        const x = Number(it.transform[4] || 0);
        const pdfY = Number(it.transform[5] || 0);
        const h = Number(it.height || Math.abs(it.transform[3]) || 7);
        const w = Number(it.width || 0);
        const topY = viewport.height - pdfY - h;
        return {
          str: it.str.trim(),
          x,
          topY,
          w,
          h,
        };
      });
    pages.push({
      pageNum,
      width: viewport.width,
      height: viewport.height,
      items,
      text: items.map((i) => i.str).join(" "),
    });
  }
  await pdf.destroy();
  return pages;
}

function findHorizontalCollisions(items, minTopY = 54, maxTopY = 785) {
  const inBand = items.filter((it) => it.topY >= minTopY && it.topY <= maxTopY && it.w > 0);
  const rows = [];
  for (const item of inBand) {
    const bucket = rows.find((r) => Math.abs(r.y - item.topY) <= 2.2);
    if (bucket) {
      bucket.items.push(item);
    } else {
      rows.push({ y: item.topY, items: [item] });
    }
  }
  const collisions = [];
  for (const row of rows) {
    const sorted = [...row.items].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.x + prev.w - curr.x > 1.5) {
        collisions.push({
          y: Number(row.y.toFixed(1)),
          leftText: prev.str,
          leftEnd: Number((prev.x + prev.w).toFixed(1)),
          rightText: curr.str,
          rightStart: Number(curr.x.toFixed(1)),
        });
      }
    }
  }
  return collisions;
}

function makeProjectRecord(overrides = {}) {
  return {
    id: "p1",
    name: "Order Service",
    branch: "main",
    branchSource: "GIT_DEFAULT",
    snapshotLabel: "#1 (abc1234)",
    lifecycleStatus: "DOING",
    isExcludedFromActiveKpis: false,
    isPinned: false,
    healthScore: 88,
    grade: "A",
    gateStatus: "PASSED",
    gateLabel: "READY TO RELEASE",
    unifiedCoveragePct: 86,
    passRatePct: 100,
    repoUrl: "https://github.com/org/order",
    frameworks: ["Jest", "Supertest"],
    pillars: {
      unit: { coveragePct: 88, totalTests: 20, passedTests: 20, failedTests: 0 },
      integration: {
        coveragePct: 84,
        totalApis: 10,
        coveredApis: 9,
        uncoveredApis: 0,
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
      },
      system: { coveragePct: 82, totalTests: 5, passedTests: 5, failedTests: 0 },
    },
    timeRoi: {
      actualAutoDurationMs: 2500,
      estimatedManualHours: 1.5,
      totalHoursSaved: 1.4,
      speedupMultiplier: 20,
      speedupStr: "20x Faster",
    },
    aiMetrics: {
      aiGeneratedTests: 5,
      aiRepairedTests: 1,
      uncoveredGaps: 0,
      lowBranchUnitFilesCount: 0,
    },
    provenance: {
      lastExecutedAt: "2026-11-26T10:00:00.000Z",
    },
    ...overrides,
  };
}

function makeOverviewFixture(projects = []) {
  const lc = {
    total: projects.length,
    DOING: projects.filter((p) => p.lifecycleStatus === "DOING").length,
    NOT_STARTED: projects.filter((p) => p.lifecycleStatus === "NOT_STARTED").length,
    PAUSED: projects.filter((p) => p.lifecycleStatus === "PAUSED").length,
    COMPLETED: projects.filter((p) => p.lifecycleStatus === "COMPLETED").length,
    CANCELLED: projects.filter((p) => p.lifecycleStatus === "CANCELLED").length,
  };

  return {
    projects,
    lifecycleCounts: lc,
    activeKpis: {
      totalProjects: lc.DOING,
      card1Health: {
        avgHealthScore: lc.DOING > 0 ? 74 : null,
        grade: lc.DOING > 0 ? "B" : "—",
        totalProjects: lc.DOING,
        testedProjects: projects.filter(
          (p) => p.lifecycleStatus === "DOING" && p.gateStatus !== "UNTESTED",
        ).length,
      },
      card2Coverage: {
        unifiedCoveragePct: lc.DOING > 0 ? 78.5 : null,
        avgUnitCoveragePct: lc.DOING > 0 ? 80 : null,
        avgIntegrationCoveragePct: lc.DOING > 0 ? 75 : null,
        avgSystemCoveragePct: null,
        layerCoverageMeta: {
          unit: { avgPct: 80, measuredCount: lc.DOING, totalKpiProjects: lc.DOING },
          integration: { avgPct: 75, measuredCount: lc.DOING, totalKpiProjects: lc.DOING },
          system: { avgPct: null, measuredCount: 0, totalKpiProjects: lc.DOING },
        },
      },
      card3Scale: {
        totalExecutedTests: lc.DOING > 0 ? 35 : 0,
        totalPassedTests: lc.DOING > 0 ? 33 : 0,
        totalFailedTests: lc.DOING > 0 ? 2 : 0,
        overallPassRatePct: lc.DOING > 0 ? 94.3 : null,
      },
      card4AiImpact: {
        aiGeneratedCount: 5,
        aiRepairedCount: 1,
        uncoveredGapsCount: 2,
      },
      timeRoi: {
        totalQaHoursSaved: lc.DOING > 0 ? 2.4 : 0,
      },
    },
    analytics: {
      quadrantNodes: projects
        .filter((p) => p.lifecycleStatus === "DOING")
        .map((p) => ({
          projectId: p.id,
          name: p.name,
          x: p.unifiedCoveragePct,
          y: p.passRatePct,
          quadrantId:
            p.gateStatus === "UNTESTED"
              ? "untested"
              : (p.unifiedCoveragePct ?? 0) >= 70 && (p.passRatePct ?? 0) >= 85
                ? "healthy-stars"
                : "critical-risk",
          isUntested: p.gateStatus === "UNTESTED",
        })),
    },
  };
}

function makeRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("Phase 3: Portfolio Export Engine (Canonical DTO, PDFKit, CSV Security & Controller)", () => {
  test("buildPortfolioReportDto enforces scopes, IDOR guard on filtered scope, and exporter identity", async () => {
    const p1 = makeProjectRecord({
      id: "p_doing_1",
      name: "Hệ thống Quản lý Đơn hàng",
      branch: "release/v2.4",
      lifecycleStatus: "DOING",
    });
    const p2 = makeProjectRecord({
      id: "p_done_2",
      name: "Legacy Billing",
      branch: "archive-v1",
      lifecycleStatus: "COMPLETED",
    });
    const p3 = makeProjectRecord({
      id: "p_new_3",
      name: "New Microservice",
      branch: "local",
      lifecycleStatus: "NOT_STARTED",
      gateStatus: "UNTESTED",
      healthScore: null,
      unifiedCoveragePct: null,
      passRatePct: null,
    });

    const overview = makeOverviewFixture([p1, p2, p3]);
    const mockDb = {
      user: {
        findUnique: jest.fn(async () => ({
          id: "u1",
          name: "Trần Hữu Thuận",
          email: "thuan@covai.dev",
        })),
      },
    };

    // 1. active_kpi scope -> only DOING
    const activeDto = await buildPortfolioReportDto({
      userId: "u1",
      scope: "active", // alias for active_kpi
      overview,
      db: mockDb,
      now: new Date("2026-11-27T04:00:00.000Z"),
    });
    expect(activeDto.metadata.scope).toBe("active_kpi");
    expect(activeDto.metadata.generatedBy.displayLabel).toBe("Trần Hữu Thuận (thuan@covai.dev)");
    expect(activeDto.projects.map((p) => p.id)).toEqual(["p_doing_1"]);
    expect(activeDto.projects[0].branch).toBe("release/v2.4");
    expect(activeDto.projects[0].kpiScope).toBe("Included");

    // 2. all scope -> all 3 with Included / Isolated tagging
    const allDto = await buildPortfolioReportDto({
      userId: "u1",
      scope: "all",
      overview,
      db: mockDb,
    });
    expect(allDto.projects).toHaveLength(3);
    expect(allDto.projects.find((p) => p.id === "p_done_2").kpiScope).toBe("Isolated");
    expect(allDto.projects.find((p) => p.id === "p_new_3").kpiScope).toBe("Isolated");

    // 3. filtered scope + IDOR injection attempt ("foreign_secret_proj" must be stripped)
    const filteredDto = await buildPortfolioReportDto({
      userId: "u1",
      scope: "filtered",
      projectIds: ["p_done_2", "foreign_secret_proj", "p_doing_1"],
      overview,
      db: mockDb,
    });
    expect(filteredDto.projects.map((p) => p.id)).toEqual(["p_done_2", "p_doing_1"]);
    expect(filteredDto.projects.some((p) => p.id === "foreign_secret_proj")).toBe(false);
  });

  test("synthesizeDeterministicPortfolioFindings is 100% honest on 0-projects, 0-DOING, blockers, and healthy portfolios", () => {
    // 1. Empty workspace
    const emptyFindings = synthesizeDeterministicPortfolioFindings({
      overview: makeOverviewFixture([]),
      scopeProjects: [],
      scope: "active_kpi",
    });
    expect(emptyFindings).toHaveLength(1);
    expect(emptyFindings[0].category).toBe("portfolio-empty");

    // 2. 0 DOING projects (all Not Started / Completed) -> never outputs positive health praise
    const onlyBacklog = makeProjectRecord({
      id: "p_ns",
      name: "Fresh Repo",
      lifecycleStatus: "NOT_STARTED",
      gateStatus: "UNTESTED",
      healthScore: null,
    });
    const zeroDoingFindings = synthesizeDeterministicPortfolioFindings({
      overview: makeOverviewFixture([onlyBacklog]),
      scopeProjects: [],
      scope: "active_kpi",
    });
    expect(zeroDoingFindings[0].title).toMatch(/No active \(Doing\) projects/i);
    expect(zeroDoingFindings[0].detail).toMatch(/remain unmeasured \(—\)/i);
    expect(zeroDoingFindings.some((f) => f.category === "verified-healthy")).toBe(false);

    // 3. Real blockers + <80% coverage + uncovered APIs + unmeasured layer + untested active
    const blockerProj = makeProjectRecord({
      id: "p_bad",
      name: "Checkout API",
      unifiedCoveragePct: 62.5,
      passRatePct: 75.0,
      gateStatus: "BLOCKED",
      pillars: {
        unit: { coveragePct: 70, totalTests: 8, passedTests: 6, failedTests: 2 },
        integration: {
          coveragePct: 50,
          totalApis: 6,
          coveredApis: 3,
          uncoveredApis: 3,
          totalTests: 4,
          passedTests: 3,
          failedTests: 1,
        },
        system: { coveragePct: null, totalTests: 0, passedTests: 0, failedTests: 0 },
      },
      aiMetrics: { lowBranchUnitFilesCount: 2 },
    });
    const untestedActive = makeProjectRecord({
      id: "p_untested",
      name: "Worker Queue",
      gateStatus: "UNTESTED",
      healthScore: null,
      unifiedCoveragePct: null,
      passRatePct: null,
      pillars: {
        unit: { coveragePct: null, totalTests: 0, passedTests: 0, failedTests: 0 },
        integration: { coveragePct: null, totalApis: 4, uncoveredApis: 4, totalTests: 0, passedTests: 0, failedTests: 0 },
        system: { coveragePct: null, totalTests: 0, passedTests: 0, failedTests: 0 },
      },
    });

    const badFindings = synthesizeDeterministicPortfolioFindings({
      overview: makeOverviewFixture([blockerProj, untestedActive]),
      scopeProjects: [blockerProj, untestedActive],
      scope: "active_kpi",
      now: new Date("2026-11-27T12:00:00.000Z"),
    });
    expect(badFindings.some((f) => f.severity === "CRITICAL" && f.detail.includes("Checkout API"))).toBe(true);
    expect(badFindings.some((f) => f.category === "coverage-below-target" && f.detail.includes("62.5%"))).toBe(true);
    expect(badFindings.some((f) => f.category === "uncovered-apis" && f.detail.includes("3 of 6"))).toBe(true);
    expect(badFindings.some((f) => f.category === "unmeasured-layers" && f.title.includes("E2E"))).toBe(true);
    expect(badFindings.some((f) => f.category === "untested-active" && f.title.includes("Worker Queue"))).toBe(true);

    // 4. All green verified healthy
    const healthyProj = makeProjectRecord({ id: "p_ok", name: "Core Auth" });
    const healthyFindings = synthesizeDeterministicPortfolioFindings({
      overview: makeOverviewFixture([healthyProj]),
      scopeProjects: [healthyProj],
      scope: "active_kpi",
      now: new Date("2026-11-27T10:00:00.000Z"),
    });
    expect(healthyFindings[0].category).toBe("verified-healthy");
  });

  test("formatPortfolioReportCsv outputs UTF-8 BOM, RFC 4180 quotes, and neutralizes CSV formula injection", async () => {
    const evilProj = makeProjectRecord({
      id: "p_evil",
      name: '=HYPERLINK("http://evil.local","Click")',
      branch: "+cmd|'/C calc'!A0",
      repoUrl: "@SUM(1+1)",
    });
    const vietProj = makeProjectRecord({
      id: "p_vi",
      name: 'Quản lý "Đơn hàng", Kho',
      branch: "-main-branch",
    });

    const dto = await buildPortfolioReportDto({
      userId: "u1",
      scope: "all",
      overview: makeOverviewFixture([evilProj, vietProj]),
      db: { user: { findUnique: jest.fn(async () => ({ id: "u1", name: "QA Lead", email: "qa@covai.dev" })) } },
    });

    expect(sanitizeCsvCell("\t=1+1")).toBe("'\t=1+1");
    expect(sanitizeCsvCell(42)).toBe("42");

    const csv = formatPortfolioReportCsv(dto);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.local"",""Click"")"`);
    expect(csv).toContain("'+cmd|'/C calc'!A0");
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain(`"Quản lý ""Đơn hàng"", Kho"`);
    expect(csv).toContain("'-main-branch");
  });

  test("renderPortfolioPdf renders Editorial Enterprise A4 PDFs cleanly for both sparse (0 Doing) and rich 12-project multi-page portfolios", async () => {
    const BANNED_LABELS = [
      "Zero LLM synthesis",
      "Deterministic Priority Findings",
      "PORTFOLIO QUALITY AUDIT",
      "Executive KPI Notice",
      "Regress.",
      "Cov % (Cut",
    ];

    // 1. Rich multi-page (12 projects) covering Vietnamese UTF-8, all 5 lifecycle states & 4 risk quadrants
    const lifecycleCycle = ["DOING", "DOING", "DOING", "DOING", "DOING", "DOING", "DOING", "DOING", "NOT_STARTED", "PAUSED", "COMPLETED", "CANCELLED"];
    const richProjects = Array.from({ length: 12 }, (_, i) => {
      const lc = lifecycleCycle[i];
      const isUntested = i === 7 || lc === "NOT_STARTED";
      // Spread DOING projects across Healthy (0,1), Blind Spot (2,3), Regression (4), Critical (5,6), Untested (7)
      const covByIdx = [92, 86, 54, 62, 78, 48, 52, null, null, 81, 89, 40][i];
      const passByIdx = [98, 95, 96, 91, 72, 68, 74, null, null, 92, 100, 60][i];
      const healthByIdx = [94, 88, 72, 75, 70, 52, 58, null, null, 85, 93, 45][i];
      const gateByIdx = isUntested
        ? "UNTESTED"
        : passByIdx >= 95 && healthByIdx >= 80
          ? "PASSED"
          : passByIdx < 80
            ? "BLOCKED"
            : "AT_RISK";
      const failedTests = passByIdx !== null && passByIdx < 95 ? 3 : 0;

      return makeProjectRecord({
        id: `p_${i + 1}`,
        name: `Dự án Kiểm thử #${i + 1} — Quản lý Đơn hàng`,
        branch: i % 2 === 0 ? "main" : "feat/vn-payment-gateway",
        lifecycleStatus: lc,
        gateStatus: gateByIdx,
        healthScore: healthByIdx,
        unifiedCoveragePct: covByIdx,
        passRatePct: passByIdx,
        pillars: {
          unit: {
            coveragePct: covByIdx !== null ? Math.min(100, covByIdx + 4) : null,
            totalTests: isUntested ? 0 : 25,
            passedTests: isUntested ? 0 : 25 - failedTests,
            failedTests,
          },
          integration: {
            coveragePct: covByIdx,
            totalApis: 10,
            coveredApis: covByIdx !== null ? 8 : 0,
            uncoveredApis: covByIdx !== null && covByIdx < 80 ? 2 : 0,
            totalTests: isUntested ? 0 : 12,
            passedTests: isUntested ? 0 : 12,
            failedTests: 0,
          },
          system: {
            coveragePct: covByIdx !== null ? Math.max(20, covByIdx - 6) : null,
            totalTests: isUntested ? 0 : 6,
            passedTests: isUntested ? 0 : 6,
            failedTests: 0,
          },
        },
        aiMetrics: {
          aiGeneratedTests: 8,
          aiRepairedTests: 2,
          uncoveredGaps: covByIdx !== null && covByIdx < 80 ? 2 : 0,
          lowBranchUnitFilesCount: covByIdx !== null && covByIdx < 65 ? 2 : 0,
        },
      });
    });

    const dtoRich = await buildPortfolioReportDto({
      userId: "u1",
      scope: "all",
      overview: makeOverviewFixture(richProjects),
      db: {
        user: {
          findUnique: jest.fn(async () => ({
            id: "u1",
            name: "Trần Hữu Thuận",
            email: "thuan@covai.dev",
          })),
        },
      },
    });

    const richBuf = await renderPortfolioPdf(dtoRich);
    expect(Buffer.isBuffer(richBuf)).toBe(true);
    expect(richBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const richPages = await extractPdfLayoutPages(richBuf);
    expect(richPages.length).toBeGreaterThanOrEqual(2);
    const richFullText = richPages.map((p) => p.text).join(" ");

    for (const banned of BANNED_LABELS) {
      expect(richFullText).not.toContain(banned);
    }
    expect(richFullText).toContain("Portfolio Quality & Coverage Report");
    expect(richFullText).toContain("Project Benchmark Comparison");
    expect(richFullText).toContain("Quality Audit Findings & Action Plan");
    expect(richFullText).toContain("Appendix — Methodology & Metric Definitions");
    expect(richFullText).toContain("Unified Coverage (%) — Threshold 70%");
    expect(richFullText).toContain("Test Pass Rate (%) — Threshold 85%");
    expect(richFullText).toContain("Healthy");
    expect(richFullText).toContain("Blind Spot");
    expect(richFullText).toContain("Regression");
    expect(richFullText).toContain("Critical Risk");
    expect(richFullText).toContain("Dự án Kiểm thử #1 — Quản lý Đơn hàng");
    expect(
      (richFullText.match(/re-normalized across measured layers only/gi) || []).length,
    ).toBe(1);

    const richHeadingPage = richPages.find((p) =>
      p.text.includes("Risk Quadrant & Project Benchmarks"),
    );
    const richPlotPage = richPages.find((p) =>
      p.text.includes("Unified Coverage (%) — Threshold 70%"),
    );
    expect(richHeadingPage).toBeDefined();
    expect(richHeadingPage.pageNum).toBe(richPlotPage?.pageNum);

    for (const page of richPages) {
      expect(page.text).toContain(`Page ${page.pageNum} of ${richPages.length}`);
      if (page.pageNum >= 2) {
        const bodyItems = page.items.filter(
          (it) => it.topY > 36 && it.topY < 790,
        );
        expect(bodyItems.length).toBeGreaterThan(0);
        const minBodyTop = Math.min(...bodyItems.map((it) => it.topY));
        // Running header rule sits at y=36; content must breathe >= 18pt below it (topY >= 54)
        expect(minBodyTop).toBeGreaterThanOrEqual(54);
      }
      expect(findHorizontalCollisions(page.items)).toEqual([]);
    }

    // 2. Sparse (0 Doing, 2 Not Started) PDF renders cleanly & omits empty benchmark section
    const sparseBacklog = [
      makeProjectRecord({
        id: "p_ns_1",
        name: "Tạo hóa đơn tự động",
        branch: "main",
        lifecycleStatus: "NOT_STARTED",
        gateStatus: "UNTESTED",
        healthScore: null,
        unifiedCoveragePct: null,
        passRatePct: null,
        pillars: {
          unit: { coveragePct: null, totalTests: 0, passedTests: 0, failedTests: 0 },
          integration: { coveragePct: null, totalApis: 0, coveredApis: 0, uncoveredApis: 0, totalTests: 0, passedTests: 0, failedTests: 0 },
          system: { coveragePct: null, totalTests: 0, passedTests: 0, failedTests: 0 },
        },
        timeRoi: { actualAutoDurationMs: 0, estimatedManualHours: 0, totalHoursSaved: 0, speedupMultiplier: 0, speedupStr: "—" },
        aiMetrics: { aiGeneratedTests: 0, aiRepairedTests: 0, uncoveredGaps: 0, lowBranchUnitFilesCount: 0 },
        provenance: { lastExecutedAt: null },
      }),
      makeProjectRecord({
        id: "p_ns_2",
        name: "Billing Worker Service",
        branch: "develop",
        lifecycleStatus: "NOT_STARTED",
        gateStatus: "UNTESTED",
        healthScore: null,
        unifiedCoveragePct: null,
        passRatePct: null,
        pillars: {
          unit: { coveragePct: null, totalTests: 0, passedTests: 0, failedTests: 0 },
          integration: { coveragePct: null, totalApis: 0, coveredApis: 0, uncoveredApis: 0, totalTests: 0, passedTests: 0, failedTests: 0 },
          system: { coveragePct: null, totalTests: 0, passedTests: 0, failedTests: 0 },
        },
        timeRoi: { actualAutoDurationMs: 0, estimatedManualHours: 0, totalHoursSaved: 0, speedupMultiplier: 0, speedupStr: "—" },
        aiMetrics: { aiGeneratedTests: 0, aiRepairedTests: 0, uncoveredGaps: 0, lowBranchUnitFilesCount: 0 },
        provenance: { lastExecutedAt: null },
      }),
    ];
    const dtoSparse = await buildPortfolioReportDto({
      userId: "u1",
      scope: "all",
      overview: makeOverviewFixture(sparseBacklog),
      db: { user: { findUnique: jest.fn(async () => ({ id: "u1", name: "QA", email: "qa@covai.dev" })) } },
    });
    const sparseBuf = await renderPortfolioPdf(dtoSparse);
    expect(sparseBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const sparsePages = await extractPdfLayoutPages(sparseBuf);
    const sparseText = sparsePages.map((p) => p.text).join(" ");
    for (const banned of BANNED_LABELS) {
      expect(sparseText).not.toContain(banned);
    }
    expect(sparseText).not.toContain("Project Benchmark Comparison");
    expect(sparseText).toContain("Quality Audit Findings & Action Plan");
    expect(
      (sparseText.match(/re-normalized across measured layers only/gi) || []).length,
    ).toBe(1);
    const sparseHeadingPage = sparsePages.find((p) =>
      p.text.includes("Risk Quadrant & Project Benchmarks"),
    );
    const sparsePlotPage = sparsePages.find((p) =>
      p.text.includes("Unified Coverage (%) — Threshold 70%"),
    );
    expect(sparseHeadingPage).toBeDefined();
    expect(sparseHeadingPage.pageNum).toBe(sparsePlotPage?.pageNum);

    for (const page of sparsePages) {
      expect(page.text).toContain(`Page ${page.pageNum} of ${sparsePages.length}`);
      if (page.pageNum >= 2) {
        const bodyItems = page.items.filter((it) => it.topY > 36 && it.topY < 790);
        if (bodyItems.length > 0) {
          expect(Math.min(...bodyItems.map((it) => it.topY))).toBeGreaterThanOrEqual(54);
        }
      }
      expect(findHorizontalCollisions(page.items)).toEqual([]);
    }

    // 3. Sparse active_kpi scope keeps Risk Quadrant heading & chart together and uses "unmeasured (—)"
    const dtoSparseActive = await buildPortfolioReportDto({
      userId: "u1",
      scope: "active_kpi",
      overview: makeOverviewFixture(sparseBacklog),
      db: { user: { findUnique: jest.fn(async () => ({ id: "u1", name: "QA", email: "qa@covai.dev" })) } },
    });
    const sparseActiveBuf = await renderPortfolioPdf(dtoSparseActive);
    const sparseActivePages = await extractPdfLayoutPages(sparseActiveBuf);
    const sparseActiveText = sparseActivePages.map((p) => p.text).join(" ");
    expect(sparseActiveText).toContain("Executive KPIs remain unmeasured (—) while Doing count is 0.");
    const activeHeadingPage = sparseActivePages.find((p) =>
      p.text.includes("Risk Quadrant & Project Benchmarks"),
    );
    const activePlotPage = sparseActivePages.find((p) =>
      p.text.includes("Unified Coverage (%) — Threshold 70%"),
    );
    expect(activeHeadingPage).toBeDefined();
    expect(activeHeadingPage.pageNum).toBe(activePlotPage?.pageNum);
  });

  test("exportPortfolioReportController serves PDF, CSV, JSON, GET compatibility, and validates input", async () => {
    const p1 = makeProjectRecord({ id: "p_ctrl_1", name: "Portfolio Controller Test", lifecycleStatus: "DOING" });
    const ownedProjectFindMany = jest.spyOn(prisma.project, "findMany").mockResolvedValue([
      {
        id: "p_ctrl_1",
        ownerId: "u1",
        name: "Portfolio Controller Test",
        description: "Test",
        repoUrl: "https://github.com/org/p1",
        defaultBranch: "develop",
        activeSnapshotId: "snap_1",
        activeVcsBranchId: null,
        lifecycleStatus: "DOING",
        lifecycleUpdatedAt: new Date("2026-11-27T00:00:00Z"),
        isPinned: false,
        hasJest: true,
        hasVitest: false,
        hasPlaywright: false,
        hasCypress: false,
        createdAt: new Date("2026-11-01T00:00:00Z"),
        updatedAt: new Date("2026-11-27T00:00:00Z"),
        members: [],
        snapshots: [{ id: "snap_1" }],
        _count: { snapshots: 1 },
      },
    ]);
    const userSpy = jest.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "u1",
      name: "Controller Tester",
      email: "tester@covai.dev",
    });
    const snapSpy = jest.spyOn(prisma.projectSnapshot, "findMany").mockResolvedValue([
      { id: "snap_1", projectId: "p_ctrl_1", versionNumber: 1, label: "v1", contentHash: "abc", commitSha: null, vcsBranchId: null, createdAt: new Date(), vcsBranch: null },
    ]);
    const vcsSpy = jest.spyOn(prisma.snapshotVcsBranch, "findMany").mockResolvedValue([]);
    const covSpy = jest.spyOn(prisma.coverageSummary, "findMany").mockResolvedValue([]);
    const covFileSpy = jest.spyOn(prisma.coverageFile, "findMany").mockResolvedValue([]);
    const runSpy = jest.spyOn(prisma.testRun, "findMany").mockResolvedValue([]);
    const aiSpy = jest.spyOn(prisma.aiTest, "findMany").mockResolvedValue([]);
    const sysSpy = jest.spyOn(prisma.systemScenario, "findMany").mockResolvedValue([]);
    const propSpy = jest.spyOn(prisma.systemTestProposal, "groupBy").mockResolvedValue([]);
    const jobSpy = jest.spyOn(prisma.job, "findMany").mockResolvedValue([]);
    const structSpy = jest.spyOn(prisma.projectStructureAnalysis, "findMany").mockResolvedValue([]);

    try {
      // 1. Invalid format -> 400
      const badFormatRes = makeRes();
      await exportPortfolioReportController(
        { method: "POST", user: { id: "u1" }, body: { format: "xlsx", scope: "active_kpi" } },
        badFormatRes,
      );
      expect(badFormatRes.statusCode).toBe(400);

      // 2. POST PDF
      const pdfRes = makeRes();
      await exportPortfolioReportController(
        { method: "POST", user: { id: "u1" }, body: { format: "pdf", scope: "active_kpi" } },
        pdfRes,
      );
      expect(pdfRes.statusCode).toBe(200);
      expect(pdfRes.headers["content-type"]).toBe("application/pdf");
      expect(pdfRes.headers["cache-control"]).toBe("no-store");
      expect(pdfRes.headers["x-content-type-options"]).toBe("nosniff");
      expect(pdfRes.headers["content-disposition"]).toMatch(
        /^attachment; filename="covai-portfolio-report-active-kpi-\d{4}-\d{2}-\d{2}\.pdf"$/,
      );
      expect(pdfRes.body.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      // 3. POST CSV
      const csvRes = makeRes();
      await exportPortfolioReportController(
        { method: "POST", user: { id: "u1" }, body: { format: "csv", scope: "all" } },
        csvRes,
      );
      expect(csvRes.statusCode).toBe(200);
      expect(csvRes.headers["content-type"]).toBe("text/csv; charset=utf-8");
      const csvText = csvRes.body.toString("utf8");
      expect(csvText.startsWith("\uFEFF")).toBe(true);
      expect(csvText).toContain("Portfolio Controller Test");
      expect(csvText).toContain("develop");

      // 4. GET JSON compatibility
      const jsonRes = makeRes();
      await exportPortfolioReportController(
        { method: "GET", user: { id: "u1" }, query: { format: "json", scope: "filtered", projectIds: "p_ctrl_1,foreign_id" } },
        jsonRes,
      );
      expect(jsonRes.statusCode).toBe(200);
      expect(jsonRes.headers["content-type"]).toBe("application/json; charset=utf-8");
      const parsed = JSON.parse(jsonRes.body.toString("utf8"));
      expect(parsed.metadata.generatedBy.email).toBe("tester@covai.dev");
      expect(parsed.projects.map((p) => p.id)).toEqual(["p_ctrl_1"]);
      expect(parsed.projects[0].branch).toBe("develop");
    } finally {
      ownedProjectFindMany.mockRestore();
      userSpy.mockRestore();
      snapSpy.mockRestore();
      vcsSpy.mockRestore();
      covSpy.mockRestore();
      covFileSpy.mockRestore();
      runSpy.mockRestore();
      aiSpy.mockRestore();
      sysSpy.mockRestore();
      propSpy.mockRestore();
      jobSpy.mockRestore();
      structSpy.mockRestore();
    }

    expect(p1.id).toBe("p_ctrl_1");
    expect(buildPortfolioExportFilename({ scope: "all", format: "pdf", now: new Date("2026-11-27T00:00:00Z") })).toBe(
      "covai-portfolio-report-all-2026-11-27.pdf",
    );
    expect(typeof formatPortfolioReportJson).toBe("function");
  });
});
