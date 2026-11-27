/**
 * @file portfolio.controller.js
 * @description Controllers for Multi-Project Portfolio Dashboard endpoints:
 * overview, batch test execution, side-by-side radar comparison, and multi-format export.
 */

import { buildPortfolioOverview } from "../services/portfolioDashboard.service.js";
import { createRunTestsJob } from "../services/job.service.js";
import { addJobToQueue } from "../services/queue.service.js";
import { emitPortfolioRunStarted } from "../realtime/portfolioSocket.emitter.js";
import prisma from "../config/prisma.js";
import { membershipWhere } from "../services/projectAccess.service.js";
import { roleAllows } from "../../../shared/projectAccess.js";
import {
  normalizePortfolioExportFormat,
  normalizePortfolioExportScope,
} from "../../../shared/portfolioGovernance.js";
import {
  buildPortfolioExportFilename,
  buildPortfolioReportDto,
  formatPortfolioReportCsv,
  formatPortfolioReportJson,
} from "../services/portfolioReport.service.js";
import { renderPortfolioPdf } from "../services/portfolioPdf.service.js";
import { ServiceError } from "../utils/serviceError.js";

let activePortfolioExports = 0;
const MAX_ACTIVE_PORTFOLIO_EXPORTS = 2;

export async function getPortfolioOverviewController(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const bypassCache = req.query?.refresh === "true" || req.query?.bypassCache === "true";
    const overview = await buildPortfolioOverview({ userId, bypassCache });

    return res.status(200).json({
      success: true,
      data: overview,
    });
  } catch (error) {
    console.error("[getPortfolioOverviewController] Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load portfolio overview",
    });
  }
}

export async function batchRunSuitesController(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { projectIds, pillars = ["unit"] } = req.body || {};

    let targetProjects = [];
    const batchProjectSelect = {
      id: true,
      name: true,
      ownerId: true,
      activeSnapshotId: true,
      members: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    };

    if (Array.isArray(projectIds) && projectIds.length > 0) {
      targetProjects = await prisma.project.findMany({
        where: {
          id: { in: projectIds },
          ...membershipWhere(userId),
        },
        select: batchProjectSelect,
      });
    } else {
      // Default: all open projects (DOING or NOT_STARTED)
      targetProjects = await prisma.project.findMany({
        where: {
          ...membershipWhere(userId),
          lifecycleStatus: { in: ["DOING", "NOT_STARTED"] },
        },
        orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
        take: 10,
        select: batchProjectSelect,
      });
    }

    const scheduledJobs = [];

    for (const project of targetProjects) {
      const role = project.ownerId === userId ? "OWNER" : (project.members?.[0]?.role || "VIEWER");
      if (!roleAllows(role, "tests.run")) continue;

      const snapshotId = project.activeSnapshotId || project.snapshots?.[0]?.id || null;
      if (!snapshotId) continue;

      try {
        const job = await createRunTestsJob({
          projectId: project.id,
          snapshotId,
          userId,
          mode: "FULL",
        });

        if (job?.id) {
          await addJobToQueue("RUN_TESTS", job.id).catch((err) => {
            console.warn(`[BatchRun] Failed to queue BullMQ job ${job.id}:`, err.message);
          });

          emitPortfolioRunStarted({
            projectId: project.id,
            snapshotId,
            jobId: job.id,
            jobType: "RUN_TESTS",
            pillar: "unit",
            userId,
          });

          scheduledJobs.push({
            projectId: project.id,
            projectName: project.name,
            jobId: job.id,
            status: "QUEUED",
          });
        }
      } catch (err) {
        console.warn(`[BatchRun] Could not schedule job for ${project.name}:`, err.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Scheduled ${scheduledJobs.length} test suite execution(s)`,
      data: {
        scheduledJobsCount: scheduledJobs.length,
        jobs: scheduledJobs,
      },
    });
  } catch (error) {
    console.error("[batchRunSuitesController] Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to trigger batch suite execution",
    });
  }
}

export async function compareProjectsController(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const rawIds = req.query.projectIds;
    if (!rawIds) {
      return res.status(400).json({ success: false, message: "projectIds parameter is required" });
    }

    const idList = String(rawIds)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);

    const overview = await buildPortfolioOverview({ userId });
    const matching = overview.projects.filter((p) => idList.includes(p.id));

    if (matching.length === 0) {
      return res.status(404).json({ success: false, message: "No matching projects found for comparison" });
    }

    // Build 5-Axis Radar chart coordinates
    // Axes: 1. Unit Cov, 2. API Cov, 3. System Cov, 4. Pass Rate, 5. Automation Efficiency
    const radarAxes = [
      { key: "unit", label: "Unit Line Cov", max: 100 },
      { key: "integration", label: "API Endpoint Cov", max: 100 },
      { key: "system", label: "System Flow Cov", max: 100 },
      { key: "passRate", label: "Test Pass Rate", max: 100 },
      { key: "efficiency", label: "Automation ROI Efficiency", max: 100 },
    ];

    const radarSeries = matching.map((p) => ({
      projectId: p.id,
      name: p.name,
      values: {
        unit: p.pillars.unit.coveragePct || 0,
        integration: p.pillars.integration.coveragePct || 0,
        system: p.pillars.system.coveragePct || 0,
        passRate: p.passRatePct !== null ? p.passRatePct : 0,
        efficiency: p.timeRoi?.efficiencyScore || 0,
      },
    }));

    return res.status(200).json({
      success: true,
      data: {
        projects: matching,
        radar: {
          axes: radarAxes,
          series: radarSeries,
        },
      },
    });
  } catch (error) {
    console.error("[compareProjectsController] Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to build comparison data",
    });
  }
}

export async function exportPortfolioReportController(req, res) {
  let acquired = false;
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const input = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const format = normalizePortfolioExportFormat(input.format);
    if (!format) {
      return res.status(400).json({
        success: false,
        code: "INVALID_EXPORT_FORMAT",
        message: "Invalid export format. Expected one of: pdf, csv, json.",
      });
    }

    const scope = normalizePortfolioExportScope(input.scope);
    if (!scope) {
      return res.status(400).json({
        success: false,
        code: "INVALID_EXPORT_SCOPE",
        message: "Invalid export scope. Expected one of: active_kpi, all, filtered.",
      });
    }

    if (activePortfolioExports >= MAX_ACTIVE_PORTFOLIO_EXPORTS) {
      res.setHeader("Retry-After", "10");
      return res.status(429).json({
        success: false,
        code: "EXPORT_BUSY",
        message: "Other portfolio exports are currently being generated. Please try again shortly.",
      });
    }

    activePortfolioExports += 1;
    acquired = true;

    let projectIds = null;
    if (Array.isArray(input.projectIds)) {
      projectIds = input.projectIds;
    } else if (typeof input.projectIds === "string" && input.projectIds.trim()) {
      projectIds = input.projectIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    }

    const dto = await buildPortfolioReportDto({
      userId,
      scope,
      projectIds,
      sections: input.sections || null,
      filterSummary: input.filterSummary || null,
    });

    const filename = buildPortfolioExportFilename({ scope, format });
    let buffer;
    let contentType;

    if (format === "pdf") {
      buffer = await renderPortfolioPdf(dto);
      contentType = "application/pdf";
    } else if (format === "csv") {
      buffer = Buffer.from(formatPortfolioReportCsv(dto), "utf8");
      contentType = "text/csv; charset=utf-8";
    } else {
      buffer = Buffer.from(formatPortfolioReportJson(dto), "utf8");
      contentType = "application/json; charset=utf-8";
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);

    return res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof ServiceError) {
      return res.status(error.statusCode || 400).json({
        success: false,
        code: error.code || "EXPORT_ERROR",
        message: error.message,
      });
    }
    console.error("[exportPortfolioReportController] Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to export portfolio report",
    });
  } finally {
    if (acquired) {
      activePortfolioExports = Math.max(0, activePortfolioExports - 1);
    }
  }
}

