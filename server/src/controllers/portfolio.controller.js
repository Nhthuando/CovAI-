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
    if (Array.isArray(projectIds) && projectIds.length > 0) {
      targetProjects = await prisma.project.findMany({
        where: {
          id: { in: projectIds },
          ...membershipWhere(userId),
        },
        include: {
          snapshots: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, rootDir: true } },
        },
      });
    } else {
      // Default: all active projects (DOING or NOT_STARTED)
      targetProjects = await prisma.project.findMany({
        where: {
          ...membershipWhere(userId),
          lifecycleStatus: { in: ["DOING", "NOT_STARTED"] },
        },
        orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
        take: 10,
        include: {
          snapshots: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, rootDir: true } },
        },
      });
    }

    const scheduledJobs = [];

    for (const project of targetProjects) {
      const snapshot = project.snapshots?.[0];
      if (!snapshot) continue;

      try {
        const job = await createRunTestsJob({
          projectId: project.id,
          snapshotId: snapshot.id,
          userId,
          mode: "FULL",
        });

        if (job?.id) {
          await addJobToQueue("RUN_TESTS", job.id).catch((err) => {
            console.warn(`[BatchRun] Failed to queue BullMQ job ${job.id}:`, err.message);
          });

          emitPortfolioRunStarted({
            projectId: project.id,
            snapshotId: snapshot.id,
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
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { format = "json", scope = "active" } = req.method === "POST" ? req.body : req.query;

    const overview = await buildPortfolioOverview({ userId });
    let projects = overview.projects;
    if (scope === "active") {
      projects = projects.filter((p) => !p.isExcludedFromActiveKpis);
    }

    if (format === "csv") {
      const headers = [
        "Project Name",
        "Lifecycle Status",
        "Health Score",
        "Grade",
        "Gate Status",
        "Unified Cov %",
        "Unit Cov %",
        "API Cov %",
        "System Cov %",
        "Pass Rate %",
        "Total Tests",
        "Auto Duration (s)",
        "Est. Manual (h)",
        "QA Hours Saved",
        "Speedup Multiplier",
        "Pinned",
        "Repo URL",
        "Last Executed",
      ];

      const rows = projects.map((p) => [
        `"${p.name.replace(/"/g, '""')}"`,
        p.lifecycleStatus,
        p.healthScore,
        p.grade,
        p.gateStatus,
        p.unifiedCoveragePct,
        p.pillars.unit.coveragePct,
        p.pillars.integration.coveragePct,
        p.pillars.system.coveragePct,
        p.passRatePct !== null ? p.passRatePct : 0,
        p.pillars.unit.totalTests + p.pillars.integration.totalTests + p.pillars.system.totalTests,
        (p.timeRoi.actualAutoDurationMs / 1000).toFixed(1),
        p.timeRoi.estimatedManualHours,
        p.timeRoi.totalHoursSaved,
        p.timeRoi.speedupStr,
        p.isPinned ? "Yes" : "No",
        p.repoUrl || "Local",
        p.provenance.lastExecutedAt || "Never",
      ]);

      const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="covai-portfolio-report-${Date.now()}.csv"`);
      return res.status(200).send(csvContent);
    }

    // Default JSON
    return res.status(200).json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        scope,
        kpis: overview.activeKpis,
        timeRoi: overview.analytics.timeRoiAnalytics,
        projects,
      },
    });
  } catch (error) {
    console.error("[exportPortfolioReportController] Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to export portfolio report",
    });
  }
}

