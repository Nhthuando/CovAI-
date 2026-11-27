/**
 * @file portfolioPdf.service.js
 * @description Backend PDFKit A4 Editorial Enterprise Portfolio Quality & Coverage Report renderer.
 * Uses NotoSans-Regular / NotoSans-Bold for full UTF-8 Vietnamese support, isolated vector graphics
 * primitives, collision-aware charts, dynamic anti-clip table pagination, and Page X of Y footers.
 */

import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

const FONTS_DIR = new URL("../assets/fonts/", import.meta.url);

const PAGE = Object.freeze({
  width: 595.28,
  height: 841.89,
  left: 36,
  right: 36,
  contentWidth: 523.28,
  bottom: 778,
  footerRuleY: 796,
  footerTextY: 804,
  contStartY: 60,
});

const COLORS = Object.freeze({
  ink: "#0F172A",
  inkSecondary: "#334155",
  muted: "#475569",
  subtle: "#64748B",
  rule: "#CBD5E1",
  ruleLight: "#E2E8F0",
  tableHeader: "#1E293B",
  zebra: "#F8FAFC",
  track: "#E2E8F0",
  white: "#FFFFFF",
  // Restrained semantic data accents
  brand: "#1D4ED8",
  indigo: "#4F46E5",
  teal: "#0F766E",
  pass: "#15803D",
  warn: "#B45309",
  amber: "#D97706",
  orange: "#C2410C",
  danger: "#B91C1C",
  neutral: "#94A3B8",
});

const LIFECYCLE_COLOR_MAP = Object.freeze({
  DOING: COLORS.brand,
  NOT_STARTED: COLORS.neutral,
  PAUSED: COLORS.amber,
  COMPLETED: COLORS.pass,
  CANCELLED: COLORS.danger,
});

const PRIORITY_STYLE_MAP = Object.freeze({
  CRITICAL: { label: "Critical", color: COLORS.danger },
  HIGH: { label: "High", color: COLORS.warn },
  MEDIUM: { label: "Medium", color: COLORS.brand },
  INFO: { label: "Info", color: COLORS.subtle },
});

const safeText = (value, limit = 240, fallback = "—") => {
  if (value === null || value === undefined || value === "") return fallback;
  const cleaned = String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .normalize("NFC");
  if (!cleaned) return fallback;
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 3)}...` : cleaned;
};

const fmtPct = (val) =>
  val !== null && val !== undefined && val !== "" && Number.isFinite(Number(val))
    ? `${Number(Number(val).toFixed(1))}%`
    : "—";

const fmtDateShort = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
  }).format(d);
};

/**
 * Place node labels inside Risk Quadrant plot bounds without overlapping quadrant labels or each other.
 */
function placeQuadrantLabel(nx, ny, label, textW, textH, plotRect, occupiedRects) {
  const candidates = [
    { x: nx + 6, y: ny - textH / 2 },
    { x: nx + 6, y: ny - textH - 4 },
    { x: nx - textW - 6, y: ny - textH / 2 },
    { x: nx + 6, y: ny + 4 },
    { x: nx - textW / 2, y: ny - textH - 6 },
    { x: nx - textW / 2, y: ny + 6 },
  ];

  const overlaps = (a, b) =>
    !(
      a.x + a.w + 3 <= b.x ||
      b.x + b.w + 3 <= a.x ||
      a.y + a.h + 2 <= b.y ||
      b.y + b.h + 2 <= a.y
    );

  for (const cand of candidates) {
    const rect = { x: cand.x, y: cand.y, w: textW, h: textH };
    if (
      rect.x < plotRect.x + 2 ||
      rect.x + rect.w > plotRect.x + plotRect.w - 2 ||
      rect.y < plotRect.y + 2 ||
      rect.y + rect.h > plotRect.y + plotRect.h - 2
    ) {
      continue;
    }
    if (!occupiedRects.some((occ) => overlaps(rect, occ))) {
      occupiedRects.push(rect);
      return rect;
    }
  }
  return null;
}

/**
 * Render canonical PortfolioReportDTO into an A4 PDF Buffer with Editorial Enterprise styling.
 */
export const renderPortfolioPdf = (dto) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: "CovAI — Portfolio Quality & Coverage Report",
        Author: "CovAI",
        Subject: safeText(dto?.metadata?.scopeLabel, 140, "Portfolio Quality Report"),
        Creator: "CovAI Portfolio Report Engine",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      doc.registerFont(
        "Body",
        fileURLToPath(new URL("NotoSans-Regular.ttf", FONTS_DIR)),
      );
      doc.registerFont(
        "Bold",
        fileURLToPath(new URL("NotoSans-Bold.ttf", FONTS_DIR)),
      );

      const left = PAGE.left;
      const width = PAGE.contentWidth;
      const bottom = PAGE.bottom;
      let y = 0;

      const meta = dto?.metadata || {};
      const sections = meta.sections || {
        executiveKpis: true,
        lifecycleAndRisk: true,
        projectMatrix: true,
        priorityFindings: true,
      };
      const kpis = dto?.executiveKpis || {};
      const c1 = kpis.card1Health || {};
      const c2 = kpis.card2Coverage || {};
      const c3 = kpis.card3Scale || {};
      const c4 = kpis.card4AiImpact || {};
      const timeRoi = dto?.timeRoi || kpis.timeRoi || {};
      const lc = dto?.lifecycleDistribution || {};
      const risk = dto?.riskDistribution || { counts: {}, nodes: [] };
      const projects = dto?.projects || [];
      const findings = dto?.priorityFindings || [];

      const text = (value, x, top, options = {}) => {
        const { bold = false, size = 8.5, color = COLORS.ink, ...rest } = options;
        doc
          .font(bold ? "Bold" : "Body")
          .fontSize(size)
          .fillColor(color)
          .text(String(value ?? ""), x, top, {
            width,
            lineGap: 1.2,
            ...rest,
          });
      };

      const measureHeight = (
        value,
        size = 8.5,
        cellWidth = width,
        bold = false,
        lineGap = 1.2,
      ) =>
        doc
          .font(bold ? "Bold" : "Body")
          .fontSize(size)
          .heightOfString(String(value ?? ""), {
            width: cellWidth,
            lineGap,
          });

      const measureWidth = (value, size = 8.5, bold = false) =>
        doc.font(bold ? "Bold" : "Body").fontSize(size).widthOfString(String(value ?? ""));

      const drawRect = (x, top, w, h, fillColor, strokeColor = null, strokeWidth = 0.5) => {
        if (w <= 0 || h <= 0) return;
        doc.save();
        if (fillColor && strokeColor) {
          doc.rect(x, top, w, h).lineWidth(strokeWidth).fillAndStroke(fillColor, strokeColor);
        } else if (fillColor) {
          doc.rect(x, top, w, h).fill(fillColor);
        } else if (strokeColor) {
          doc.rect(x, top, w, h).lineWidth(strokeWidth).strokeColor(strokeColor).stroke();
        }
        doc.restore();
      };

      const drawLine = (x1, y1, x2, y2, strokeColor = COLORS.rule, lineWidth = 0.5) => {
        doc.save();
        doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(lineWidth).strokeColor(strokeColor).stroke();
        doc.restore();
      };

      const drawDashedLine = (
        x1,
        y1,
        x2,
        y2,
        strokeColor = COLORS.muted,
        lineWidth = 0.8,
        dash = 3,
        space = 2,
      ) => {
        doc.save();
        doc
          .moveTo(x1, y1)
          .lineTo(x2, y2)
          .lineWidth(lineWidth)
          .dash(dash, { space })
          .strokeColor(strokeColor)
          .stroke();
        doc.restore();
      };

      const drawDot = (cx, cy, r, fillColor, strokeColor = null, strokeWidth = 0.6) => {
        doc.save();
        if (strokeColor) {
          doc.circle(cx, cy, r).lineWidth(strokeWidth).fillAndStroke(fillColor, strokeColor);
        } else {
          doc.circle(cx, cy, r).fill(fillColor);
        }
        doc.restore();
      };

      const addPage = (isFirst = false) => {
        doc.addPage();
        doc.page.margins.bottom = 0;

        if (isFirst) {
          drawRect(0, 0, PAGE.width, 2.5, COLORS.tableHeader);
          drawRect(0, 0, left + 48, 2.5, COLORS.brand);
          y = 20;
        } else {
          drawRect(0, 0, PAGE.width, 1.5, COLORS.tableHeader);
          text("CovAI", left, 14, {
            size: 8.2,
            bold: true,
            color: COLORS.ink,
            width: 36,
            lineBreak: false,
          });
          text("—  Portfolio Quality & Coverage Report", left + 33, 14.3, {
            size: 7.8,
            color: COLORS.subtle,
            width: 240,
            lineBreak: false,
          });
          text(
            safeText(
              `${meta.scopeLabel || "Active KPI Scope"} · ${meta.reportId || ""}`,
              64,
            ),
            left + 280,
            14.5,
            {
              size: 7.2,
              color: COLORS.subtle,
              width: width - 280,
              align: "right",
              lineBreak: false,
            },
          );
          drawLine(left, 36, left + width, 36, COLORS.rule, 0.5);
          // Enforce >= 18pt vertical breathing space below running header rule
          y = PAGE.contStartY;
        }
      };

      const ensureSpace = (needed) => {
        if (y + needed > bottom) {
          addPage(false);
          return true;
        }
        return false;
      };

      const drawSectionHeader = (
        title,
        subtitle = null,
        rightNote = null,
        minContentSpace = 42,
      ) => {
        const subH = subtitle ? measureHeight(subtitle, 7.8, width) + 6 : 0;
        ensureSpace(26 + subH + minContentSpace);
        text(title, left, y, {
          size: 11,
          bold: true,
          color: COLORS.ink,
          width: rightNote ? width - 130 : width,
        });
        if (rightNote) {
          text(rightNote, left + width - 126, y + 2, {
            size: 7.6,
            color: COLORS.subtle,
            width: 126,
            align: "right",
            lineBreak: false,
          });
        }
        const ruleY = y + 17;
        drawLine(left, ruleY, left + width, ruleY, COLORS.rule, 0.6);
        drawLine(left, ruleY, left + 26, ruleY, COLORS.brand, 1.4);
        y = ruleY + 6;
        if (subtitle) {
          text(subtitle, left, y, {
            size: 7.8,
            color: COLORS.muted,
            width,
          });
          y += measureHeight(subtitle, 7.8, width) + 8;
        }
      };

      // ── Page 1 Editorial Masthead & 2x2 Hairline Metadata Grid ──────────
      addPage(true);

      text("CovAI", left, y, {
        size: 11.5,
        bold: true,
        color: COLORS.ink,
        width: 44,
        lineBreak: false,
      });
      text("|  Engineering Quality Intelligence", left + 40, y + 2, {
        size: 7.8,
        color: COLORS.subtle,
        width: 220,
        lineBreak: false,
      });
      text(safeText(meta.reportId, 40), left + 280, y + 2, {
        size: 8,
        bold: true,
        color: COLORS.muted,
        width: width - 280,
        align: "right",
        lineBreak: false,
      });
      y += 20;

      text("Portfolio Quality & Coverage Report", left, y, {
        size: 18.5,
        bold: true,
        color: COLORS.ink,
        width,
      });
      y += 24;

      const exportedCount = meta.exportedProjectsCount ?? projects.length;
      const totalCount = meta.totalAccessibleProjects ?? lc.total ?? projects.length;
      const scopeLine = `${safeText(meta.scopeLabel, 80, "Active KPI Scope")} — ${exportedCount} of ${totalCount} accessible workspace(s) included`;
      text(scopeLine, left, y, {
        size: 8.4,
        color: COLORS.muted,
        width,
      });
      y += measureHeight(scopeLine, 8.4, width) + 10;

      // Clean 2x2 Hairline Metadata Grid
      const halfW = width / 2;
      const cellTextW = halfW - 16;
      const r1LeftVal = safeText(meta.reportId, 48);
      const r1RightVal = safeText(meta.scopeLabel, 80);
      const r2LeftVal = safeText(meta.generatedBy?.displayLabel, 110);
      const r2RightVal = safeText(meta.generatedAtFormatted, 80);

      const r1H = Math.max(
        28,
        15 +
          Math.max(
            measureHeight(r1LeftVal, 8.2, cellTextW),
            measureHeight(r1RightVal, 8.2, cellTextW),
          ) +
          6,
      );
      const r2H = Math.max(
        28,
        15 +
          Math.max(
            measureHeight(r2LeftVal, 8.2, cellTextW),
            measureHeight(r2RightVal, 8.2, cellTextW),
          ) +
          6,
      );

      const gridTop = y;
      drawLine(left, gridTop, left + width, gridTop, COLORS.rule, 0.75);

      text("REPORT ID", left + 6, gridTop + 5, {
        size: 6.5,
        bold: true,
        color: COLORS.subtle,
        width: cellTextW,
        characterSpacing: 0.4,
      });
      text(r1LeftVal, left + 6, gridTop + 14.5, {
        size: 8.2,
        bold: true,
        color: COLORS.ink,
        width: cellTextW,
      });

      text("EXPORT SCOPE", left + halfW + 10, gridTop + 5, {
        size: 6.5,
        bold: true,
        color: COLORS.subtle,
        width: cellTextW,
        characterSpacing: 0.4,
      });
      text(r1RightVal, left + halfW + 10, gridTop + 14.5, {
        size: 8.2,
        bold: true,
        color: COLORS.ink,
        width: cellTextW,
      });

      const row2Top = gridTop + r1H;
      drawLine(left, row2Top, left + width, row2Top, COLORS.ruleLight, 0.5);

      text("PREPARED BY", left + 6, row2Top + 5, {
        size: 6.5,
        bold: true,
        color: COLORS.subtle,
        width: cellTextW,
        characterSpacing: 0.4,
      });
      text(r2LeftVal, left + 6, row2Top + 14.5, {
        size: 8.2,
        color: COLORS.ink,
        width: cellTextW,
      });

      text("GENERATED AT", left + halfW + 10, row2Top + 5, {
        size: 6.5,
        bold: true,
        color: COLORS.subtle,
        width: cellTextW,
        characterSpacing: 0.4,
      });
      text(r2RightVal, left + halfW + 10, row2Top + 14.5, {
        size: 8.2,
        color: COLORS.ink,
        width: cellTextW,
      });

      let gridBottom = row2Top + r2H;
      drawLine(left + halfW, gridTop, left + halfW, gridBottom, COLORS.ruleLight, 0.5);

      if (meta.filterSummary) {
        const filterVal = safeText(meta.filterSummary, 220);
        const r3H = Math.max(24, 14 + measureHeight(filterVal, 7.8, width - 16) + 5);
        drawLine(left, gridBottom, left + width, gridBottom, COLORS.ruleLight, 0.5);
        text("ACTIVE FILTERS", left + 6, gridBottom + 4.5, {
          size: 6.5,
          bold: true,
          color: COLORS.subtle,
          width: width - 12,
          characterSpacing: 0.4,
        });
        text(filterVal, left + 6, gridBottom + 13.5, {
          size: 7.8,
          color: COLORS.inkSecondary,
          width: width - 12,
        });
        gridBottom += r3H;
      }

      drawLine(left, gridBottom, left + width, gridBottom, COLORS.rule, 0.75);
      y = gridBottom + 16;

      // ── 1. Executive KPI Summary ────────────────────────────────────────
      if (sections.executiveKpis) {
        drawSectionHeader(
          "Executive KPI Summary",
          "Aggregated strictly across active (Doing) workspaces. Unmeasured metrics are denoted by —.",
        );

        const colW = width / 4;
        const scoreH = 74;
        ensureSpace(scoreH + 28);

        const hasHealth =
          c1.avgHealthScore !== null &&
          c1.avgHealthScore !== undefined &&
          Number.isFinite(Number(c1.avgHealthScore));
        const hasCov =
          c2.unifiedCoveragePct !== null &&
          c2.unifiedCoveragePct !== undefined &&
          Number.isFinite(Number(c2.unifiedCoveragePct));
        const hasPass =
          c3.overallPassRatePct !== null &&
          c3.overallPassRatePct !== undefined &&
          Number.isFinite(Number(c3.overallPassRatePct));
        const layerMeta = c2.layerCoverageMeta || {};
        const uMeta = layerMeta.unit || {};
        const aMeta = layerMeta.integration || {};
        const eMeta = layerMeta.system || {};

        const kpiCols = [
          {
            label: "HEALTH SCORE",
            value: hasHealth ? String(c1.avgHealthScore) : "—",
            unitSuffix: hasHealth ? "/100" : "",
            line1: `Grade ${c1.grade || "—"} · ${c1.testedProjects ?? 0}/${c1.totalProjects ?? 0} tested`,
            line2: "Quality gate target >= 80",
            valueColor: hasHealth
              ? Number(c1.avgHealthScore) >= 80
                ? COLORS.pass
                : Number(c1.avgHealthScore) >= 50
                  ? COLORS.warn
                  : COLORS.danger
              : COLORS.ink,
          },
          {
            label: "UNIFIED COVERAGE",
            value: hasCov ? fmtPct(c2.unifiedCoveragePct) : "—",
            unitSuffix: "",
            line1: `U ${fmtPct(c2.avgUnitCoveragePct)} · A ${fmtPct(c2.avgIntegrationCoveragePct)} · E ${fmtPct(c2.avgSystemCoveragePct)}`,
            line2: `Measured: U ${uMeta.measuredCount ?? 0}/${uMeta.totalKpiProjects ?? 0} · A ${aMeta.measuredCount ?? 0}/${aMeta.totalKpiProjects ?? 0} · E ${eMeta.measuredCount ?? 0}/${eMeta.totalKpiProjects ?? 0}`,
            valueColor: COLORS.ink,
          },
          {
            label: "TEST EXECUTION",
            value: String(c3.totalExecutedTests ?? 0),
            unitSuffix: (c3.totalExecutedTests ?? 0) === 1 ? " test" : " tests",
            line1: `Pass rate: ${hasPass ? fmtPct(c3.overallPassRatePct) : "—"}`,
            line2: `${c3.totalPassedTests ?? 0} passed · ${c3.totalFailedTests ?? 0} failed`,
            valueColor: (c3.totalFailedTests || 0) > 0 ? COLORS.danger : COLORS.ink,
          },
          {
            label: "EST. QA TIME SAVED",
            value: `+${Number(timeRoi.totalQaHoursSaved || 0).toFixed(1)}h`,
            unitSuffix: "",
            line1: "CovAI Baseline estimate",
            line2: `AI Gen: ${c4.aiGeneratedCount ?? 0} · Healed: ${c4.aiRepairedCount ?? 0}`,
            valueColor: Number(timeRoi.totalQaHoursSaved || 0) > 0 ? COLORS.teal : COLORS.ink,
          },
        ];

        drawLine(left, y, left + width, y, COLORS.rule, 0.75);
        kpiCols.forEach((col, idx) => {
          const cx = left + idx * colW;
          if (idx > 0) {
            drawLine(cx, y + 6, cx, y + scoreH - 6, COLORS.ruleLight, 0.5);
          }
          const innerX = cx + (idx === 0 ? 2 : 9);
          const innerW = colW - (idx === 0 ? 10 : 14);

          text(col.label, innerX, y + 8, {
            size: 6.7,
            bold: true,
            color: COLORS.subtle,
            width: innerW,
            characterSpacing: 0.4,
            lineBreak: false,
          });

          text(col.value, innerX, y + 20, {
            size: 16.5,
            bold: true,
            color: col.valueColor,
            width: innerW,
            lineBreak: false,
          });
          if (col.unitSuffix) {
            const valW = measureWidth(col.value, 16.5, true);
            if (valW + 26 <= innerW) {
              text(col.unitSuffix, innerX + valW + 2, y + 26.5, {
                size: 8,
                color: COLORS.subtle,
                width: innerW - valW - 2,
                lineBreak: false,
              });
            }
          }

          text(col.line1, innerX, y + 44, {
            size: 7.1,
            color: COLORS.inkSecondary,
            width: innerW,
          });
          text(col.line2, innerX, y + 56, {
            size: 6.8,
            color: COLORS.subtle,
            width: innerW,
          });
        });
        y += scoreH;
        drawLine(left, y, left + width, y, COLORS.rule, 0.75);
        y += 10;

        if ((meta.doingProjectsCount || 0) === 0) {
          const emptyNote =
            "No workspaces are currently in Doing state; Executive KPIs remain unmeasured (—) until a suite executes or a workspace transitions to Doing.";
          const noteH = measureHeight(emptyNote, 7.6, width - 14);
          ensureSpace(noteH + 10);
          drawLine(left + 1, y + 1, left + 1, y + noteH + 2, COLORS.neutral, 2);
          text(emptyNote, left + 10, y, {
            size: 7.6,
            color: COLORS.muted,
            width: width - 14,
          });
          y += noteH + 12;
        } else {
          y += 6;
        }
      }

      // ── 2. Coverage & Portfolio Composition ─────────────────────────────
      if (sections.lifecycleAndRisk) {
        drawSectionHeader(
          "Coverage & Portfolio Composition",
          "Active KPI layer coverage against the 80% gate alongside workspace lifecycle and execution outcome distribution.",
        );

        const compH = 166;
        ensureSpace(compH + 16);

        const colGap = 18;
        const compColW = (width - colGap) / 2; // 252.64
        const rightColX = left + compColW + colGap;

        // Vertical divider between the two editorial columns
        drawLine(
          left + compColW + colGap / 2,
          y + 2,
          left + compColW + colGap / 2,
          y + compH - 4,
          COLORS.ruleLight,
          0.5,
        );

        // ── Left Column: Bullet Chart (Multi-Layer Coverage vs 80% Gate)
        text("MULTI-LAYER COVERAGE VS. 80% GATE", left, y, {
          size: 7,
          bold: true,
          color: COLORS.muted,
          width: compColW,
          characterSpacing: 0.4,
        });

        const layerMeta = c2.layerCoverageMeta || {};
        const totalKpi = Math.max(0, Number(c1.totalProjects ?? lc.DOING ?? 0));
        const testedKpi = Math.max(0, Number(c1.testedProjects ?? 0));
        const bulletRows = [
          {
            label: "Unit (50%)",
            val: c2.avgUnitCoveragePct,
            measured: layerMeta.unit?.measuredCount ?? 0,
            total: layerMeta.unit?.totalKpiProjects ?? totalKpi,
            color: COLORS.brand,
          },
          {
            label: "API (30%)",
            val: c2.avgIntegrationCoveragePct,
            measured: layerMeta.integration?.measuredCount ?? 0,
            total: layerMeta.integration?.totalKpiProjects ?? totalKpi,
            color: COLORS.indigo,
          },
          {
            label: "E2E (20%)",
            val: c2.avgSystemCoveragePct,
            measured: layerMeta.system?.measuredCount ?? 0,
            total: layerMeta.system?.totalKpiProjects ?? totalKpi,
            color: COLORS.teal,
          },
          {
            label: "Unified Weighted",
            val: c2.unifiedCoveragePct,
            measured: testedKpi,
            total: totalKpi,
            color: COLORS.ink,
            isTotal: true,
          },
        ];

        const trackX = left + 70;
        const trackW = 112;
        const target80X = trackX + trackW * 0.8;
        const bulletStartY = y + 22;

        text("80% Gate", target80X - 20, bulletStartY - 11, {
          size: 6.3,
          bold: true,
          color: COLORS.pass,
          width: 40,
          align: "center",
          lineBreak: false,
        });

        let by = bulletStartY;
        const rowPitch = 25;
        bulletRows.forEach((row, idx) => {
          if (row.isTotal) {
            drawLine(left, by - 5, left + compColW, by - 5, COLORS.ruleLight, 0.5);
            by += 3;
          }
          text(row.label, left, by + 0.5, {
            size: row.isTotal ? 7.4 : 7.3,
            bold: Boolean(row.isTotal),
            color: row.isTotal ? COLORS.ink : COLORS.inkSecondary,
            width: 68,
            lineBreak: false,
          });

          drawRect(trackX, by + 2.5, trackW, 6.5, COLORS.track);
          if (
            row.val !== null &&
            row.val !== undefined &&
            Number.isFinite(Number(row.val))
          ) {
            const fillW = (Math.max(0, Math.min(100, Number(row.val))) / 100) * trackW;
            drawRect(trackX, by + 2.5, fillW, 6.5, row.color);
          }

          text(fmtPct(row.val), trackX + trackW + 6, by, {
            size: 7.4,
            bold: true,
            color: COLORS.ink,
            width: 30,
            align: "right",
            lineBreak: false,
          });
          text(`(${row.measured}/${row.total})`, trackX + trackW + 38, by + 0.5, {
            size: 6.6,
            color: COLORS.subtle,
            width: compColW - (trackX + trackW + 38 - left),
            align: "right",
            lineBreak: false,
          });

          if (idx === bulletRows.length - 1) {
            // Draw single crisp dashed 80% target line cleanly spanning all 4 bullet tracks
            drawDashedLine(
              target80X,
              bulletStartY - 1,
              target80X,
              by + 11,
              COLORS.pass,
              0.9,
              2.5,
              2,
            );
            const scaleY = by + 14;
            text("0%", trackX - 4, scaleY, { size: 6.2, color: COLORS.subtle, width: 16, lineBreak: false });
            text("50%", trackX + trackW * 0.5 - 10, scaleY, {
              size: 6.2,
              color: COLORS.subtle,
              width: 20,
              align: "center",
              lineBreak: false,
            });
            text("80%", target80X - 10, scaleY, {
              size: 6.2,
              bold: true,
              color: COLORS.pass,
              width: 20,
              align: "center",
              lineBreak: false,
            });
            text("100%", trackX + trackW - 18, scaleY, {
              size: 6.2,
              color: COLORS.subtle,
              width: 20,
              align: "right",
              lineBreak: false,
            });
          }
          by += rowPitch;
        });

        // ── Right Column: Lifecycle Mix & Execution Outcome Mix
        text("PORTFOLIO LIFECYCLE MIX", rightColX, y, {
          size: 7,
          bold: true,
          color: COLORS.muted,
          width: compColW,
          characterSpacing: 0.4,
        });

        const totalAll = Math.max(1, Number(lc.total || 0));
        const segments = [
          {
            label: "Doing",
            count: lc.DOING || 0,
            scope: "KPI Included",
            color: LIFECYCLE_COLOR_MAP.DOING,
          },
          {
            label: "Not Started",
            count: lc.NOT_STARTED || 0,
            scope: "Backlog",
            color: LIFECYCLE_COLOR_MAP.NOT_STARTED,
          },
          {
            label: "Paused",
            count: lc.PAUSED || 0,
            scope: "Isolated",
            color: LIFECYCLE_COLOR_MAP.PAUSED,
          },
          {
            label: "Completed",
            count: lc.COMPLETED || 0,
            scope: "Isolated",
            color: LIFECYCLE_COLOR_MAP.COMPLETED,
          },
          {
            label: "Cancelled",
            count: lc.CANCELLED || 0,
            scope: "Isolated",
            color: LIFECYCLE_COLOR_MAP.CANCELLED,
          },
        ];

        const segBarY = y + 15;
        drawRect(rightColX, segBarY, compColW, 7.5, COLORS.track);
        if ((lc.total || 0) > 0) {
          let sx = rightColX;
          for (const seg of segments) {
            if (seg.count <= 0) continue;
            const sw = (seg.count / totalAll) * compColW;
            drawRect(sx, segBarY, sw, 7.5, seg.color);
            sx += sw;
          }
        }

        let lcY = y + 29;
        for (const seg of segments) {
          drawDot(rightColX + 4, lcY + 4.5, 2.5, seg.color);
          text(seg.label, rightColX + 12, lcY, {
            size: 7.4,
            color: COLORS.ink,
            width: 80,
            lineBreak: false,
          });
          text(seg.scope, rightColX + 94, lcY + 0.3, {
            size: 6.9,
            color: COLORS.subtle,
            width: 72,
            lineBreak: false,
          });
          const sharePct =
            (lc.total || 0) > 0 ? Math.round((seg.count / totalAll) * 100) : 0;
          text(String(seg.count), rightColX + 172, lcY, {
            size: 7.4,
            bold: true,
            color: COLORS.ink,
            width: 34,
            align: "right",
            lineBreak: false,
          });
          text(`${sharePct}%`, rightColX + 210, lcY + 0.3, {
            size: 6.8,
            color: COLORS.subtle,
            width: compColW - 210,
            align: "right",
            lineBreak: false,
          });
          lcY += 14.5;
        }

        // Execution outcome mix below hairline divider
        const execTop = lcY + 6;
        drawLine(rightColX, execTop, rightColX + compColW, execTop, COLORS.ruleLight, 0.5);
        text("EXECUTION OUTCOME MIX (ACTIVE KPI SCOPE)", rightColX, execTop + 7, {
          size: 6.8,
          bold: true,
          color: COLORS.muted,
          width: compColW,
          characterSpacing: 0.4,
        });

        const totalExec = Math.max(0, Number(c3.totalExecutedTests || 0));
        const totalPassed = Math.max(0, Number(c3.totalPassedTests || 0));
        const totalFailed = Math.max(0, Number(c3.totalFailedTests || 0));
        const totalSkipped = Math.max(0, totalExec - totalPassed - totalFailed);
        const outcomeBarY = execTop + 20;
        drawRect(rightColX, outcomeBarY, compColW, 6.5, COLORS.track);
        if (totalExec > 0) {
          const outcomeSegs = [
            { val: totalPassed, color: COLORS.pass },
            { val: totalFailed, color: COLORS.danger },
            { val: totalSkipped, color: COLORS.neutral },
          ];
          let ox = rightColX;
          for (const os of outcomeSegs) {
            if (os.val <= 0) continue;
            const ow = (os.val / totalExec) * compColW;
            drawRect(ox, outcomeBarY, ow, 6.5, os.color);
            ox += ow;
          }
        }

        const legY = outcomeBarY + 12;
        drawDot(rightColX + 4, legY + 4, 2.2, COLORS.pass);
        text(`Passed: ${totalPassed}`, rightColX + 10, legY, {
          size: 7.1,
          color: COLORS.inkSecondary,
          width: 72,
          lineBreak: false,
        });
        drawDot(rightColX + 90, legY + 4, 2.2, COLORS.danger);
        text(`Failed: ${totalFailed}`, rightColX + 96, legY, {
          size: 7.1,
          color: totalFailed > 0 ? COLORS.danger : COLORS.inkSecondary,
          width: 68,
          lineBreak: false,
        });
        drawDot(rightColX + 170, legY + 4, 2.2, COLORS.neutral);
        text(`Skipped: ${totalSkipped}`, rightColX + 176, legY, {
          size: 7.1,
          color: COLORS.subtle,
          width: compColW - 176,
          lineBreak: false,
        });

        y += compH + 16;
      }

      // ── 3. Risk Quadrant & Project Benchmarks ───────────────────────────
      if (sections.lifecycleAndRisk) {
        const plottedNodes = (risk.nodes || []).filter(
          (n) =>
            !n.isUntested &&
            n.quadrantId !== "untested" &&
            n.x !== null &&
            n.x !== undefined &&
            n.y !== null &&
            n.y !== undefined,
        );
        const untestedNodes = (risk.nodes || []).filter(
          (n) =>
            n.isUntested ||
            n.quadrantId === "untested" ||
            n.x === null ||
            n.x === undefined ||
            n.y === null ||
            n.y === undefined,
        );
        const benchmarkProjects = projects
          .filter(
            (p) =>
              p.kpiScope === "Included" &&
              ((p.unifiedCoveragePct !== null &&
                p.unifiedCoveragePct !== undefined &&
                Number.isFinite(Number(p.unifiedCoveragePct))) ||
                (p.healthScore !== null &&
                  p.healthScore !== undefined &&
                  Number.isFinite(Number(p.healthScore)))),
          )
          .sort((a, b) => {
            const covDiff = Number(b.unifiedCoveragePct ?? -1) - Number(a.unifiedCoveragePct ?? -1);
            if (covDiff !== 0) return covDiff;
            return Number(b.healthScore ?? -1) - Number(a.healthScore ?? -1);
          });

        const quadBlockH = 186;
        drawSectionHeader(
          "Risk Quadrant & Project Benchmarks",
          `Active KPI workspaces plotted against ${risk.coverageCutoff ?? 70}% Unified Coverage and ${risk.passRateCutoff ?? 85}% Pass Rate thresholds.`,
          null,
          quadBlockH + 14,
        );

        const plotX = left + 46;
        const plotY = y + 6;
        const plotW = 282;
        const plotH = 136;
        const cutoffCov = Number(risk.coverageCutoff ?? 70);
        const cutoffPass = Number(risk.passRateCutoff ?? 85);
        const cutX = plotX + (cutoffCov / 100) * plotW;
        const cutY = plotY + plotH - (cutoffPass / 100) * plotH;

        // Soft editorial quadrant backgrounds
        drawRect(cutX, plotY, plotX + plotW - cutX, cutY - plotY, "#F0FDF4");
        drawRect(plotX, plotY, cutX - plotX, cutY - plotY, "#FFFBEB");
        drawRect(cutX, cutY, plotX + plotW - cutX, plotY + plotH - cutY, "#FFF7ED");
        drawRect(plotX, cutY, cutX - plotX, plotY + plotH - cutY, "#FEF2F2");

        // Subtle coordinate gridlines
        for (const pct of [25, 50, 75]) {
          const gx = plotX + (pct / 100) * plotW;
          const gy = plotY + plotH - (pct / 100) * plotH;
          drawLine(gx, plotY, gx, plotY + plotH, COLORS.ruleLight, 0.4);
          drawLine(plotX, gy, plotX + plotW, gy, COLORS.ruleLight, 0.4);
        }

        // Frame & cutoff dividers
        drawRect(plotX, plotY, plotW, plotH, null, COLORS.neutral, 0.65);
        drawDashedLine(cutX, plotY, cutX, plotY + plotH, COLORS.subtle, 0.9, 3, 2);
        drawDashedLine(plotX, cutY, plotX + plotW, cutY, COLORS.subtle, 0.9, 3, 2);

        // Rotated Y-axis label + Y ticks
        doc.save();
        const yAxisOriginY = plotY + plotH / 2 + 66;
        doc.rotate(-90, { origin: [left + 4, yAxisOriginY] });
        text(`Test Pass Rate (%) — Threshold ${cutoffPass}%`, left + 4, yAxisOriginY, {
          size: 6.7,
          bold: true,
          color: COLORS.muted,
          width: 132,
          align: "center",
          lineBreak: false,
        });
        doc.restore();

        [
          { pct: 100, label: "100%", color: COLORS.subtle, bold: false },
          { pct: cutoffPass, label: `${cutoffPass}%`, color: COLORS.muted, bold: true },
          { pct: 50, label: "50%", color: COLORS.subtle, bold: false },
          { pct: 0, label: "0%", color: COLORS.subtle, bold: false },
        ].forEach((tk) => {
          const ty = plotY + plotH - (tk.pct / 100) * plotH - 4;
          text(tk.label, plotX - 28, ty, {
            size: 6.3,
            bold: tk.bold,
            color: tk.color,
            width: 24,
            align: "right",
            lineBreak: false,
          });
        });

        // X ticks + full X-axis title
        [
          { pct: 0, label: "0%", align: "left", dx: 0 },
          { pct: 50, label: "50%", align: "center", dx: -12 },
          { pct: cutoffCov, label: `${cutoffCov}%`, align: "center", dx: -12, bold: true },
          { pct: 100, label: "100%", align: "right", dx: -24 },
        ].forEach((tk) => {
          const tx = plotX + (tk.pct / 100) * plotW + tk.dx;
          text(tk.label, tx, plotY + plotH + 4, {
            size: 6.3,
            bold: Boolean(tk.bold),
            color: tk.bold ? COLORS.muted : COLORS.subtle,
            width: 24,
            align: tk.align,
            lineBreak: false,
          });
        });
        text(`Unified Coverage (%) — Threshold ${cutoffCov}%`, plotX, plotY + plotH + 15, {
          size: 6.7,
          bold: true,
          color: COLORS.muted,
          width: plotW,
          align: "center",
          lineBreak: false,
        });

        // Full quadrant names inside plot corners (never abbreviated)
        text("Healthy", plotX + plotW - 56, plotY + 4, {
          size: 6.8,
          bold: true,
          color: COLORS.pass,
          width: 51,
          align: "right",
          lineBreak: false,
        });
        text("Blind Spot", plotX + 5, plotY + 4, {
          size: 6.8,
          bold: true,
          color: COLORS.warn,
          width: 58,
          lineBreak: false,
        });
        text("Critical Risk", plotX + 5, plotY + plotH - 12, {
          size: 6.8,
          bold: true,
          color: COLORS.danger,
          width: 64,
          lineBreak: false,
        });
        text("Regression", plotX + plotW - 60, plotY + plotH - 12, {
          size: 6.8,
          bold: true,
          color: COLORS.orange,
          width: 55,
          align: "right",
          lineBreak: false,
        });

        // Seed corner label boxes so project point labels never collide with corner titles
        const occupiedLabelRects = [
          { x: plotX + plotW - 60, y: plotY + 2, w: 58, h: 13 },
          { x: plotX + 2, y: plotY + 2, w: 62, h: 13 },
          { x: plotX + 2, y: plotY + plotH - 15, w: 68, h: 14 },
          { x: plotX + plotW - 64, y: plotY + plotH - 15, w: 62, h: 14 },
        ];
        const quadColor = {
          "healthy-stars": COLORS.pass,
          "false-security": COLORS.warn,
          "active-regressions": COLORS.orange,
          "critical-risk": COLORS.danger,
        };

        if (plottedNodes.length === 0) {
          text("No tested Doing workspaces in quadrant", plotX + 20, plotY + plotH / 2 - 6, {
            size: 7.4,
            color: COLORS.subtle,
            width: plotW - 40,
            align: "center",
          });
        } else {
          const plotRect = { x: plotX, y: plotY, w: plotW, h: plotH };
          const nodeCoords = plottedNodes.map((n, idx) => ({
            node: n,
            idx,
            nx: plotX + (Math.max(0, Math.min(100, Number(n.x))) / 100) * plotW,
            ny: plotY + plotH - (Math.max(0, Math.min(100, Number(n.y))) / 100) * plotH,
            dotColor: quadColor[n.quadrantId] || COLORS.brand,
          }));

          // Seed every plotted dot hitbox before placing text labels so labels never cover dots
          for (const nc of nodeCoords) {
            occupiedLabelRects.push({ x: nc.nx - 6, y: nc.ny - 6, w: 12, h: 12 });
          }

          nodeCoords.forEach(({ node, idx, nx, ny, dotColor }) => {
            drawDot(nx, ny, 4.2, dotColor, COLORS.white, 0.8);

            const shortLabel = safeText(node.name, 16);
            const estW = Math.min(86, measureWidth(shortLabel, 6.3, false) + 3);
            const placed = placeQuadrantLabel(
              nx,
              ny,
              shortLabel,
              estW,
              10,
              plotRect,
              occupiedLabelRects,
            );
            if (placed) {
              text(shortLabel, placed.x, placed.y + 1, {
                size: 6.3,
                color: COLORS.ink,
                width: placed.w + 2,
                lineBreak: false,
              });
            } else {
              text(String(idx + 1), nx - 4, ny - 3, {
                size: 5.8,
                bold: true,
                color: COLORS.white,
                width: 8,
                align: "center",
                lineBreak: false,
              });
            }
          });
        }

        // Right summary panel for Quadrant Breakdown & Untested isolation
        const qSumX = plotX + plotW + 16;
        const qSumW = left + width - qSumX;
        text("QUADRANT SUMMARY", qSumX, plotY, {
          size: 7,
          bold: true,
          color: COLORS.muted,
          width: qSumW,
          characterSpacing: 0.4,
        });

        const counts = risk.counts || {};
        const quadRows = [
          {
            label: "Healthy",
            rule: `Cov >=${cutoffCov}% · Pass >=${cutoffPass}%`,
            count: counts.healthyStars || 0,
            color: COLORS.pass,
          },
          {
            label: "Blind Spot",
            rule: `Cov <${cutoffCov}% · Pass >=${cutoffPass}%`,
            count: counts.falseSecurity || 0,
            color: COLORS.warn,
          },
          {
            label: "Regression",
            rule: `Cov >=${cutoffCov}% · Pass <${cutoffPass}%`,
            count: counts.activeRegressions || 0,
            color: COLORS.orange,
          },
          {
            label: "Critical Risk",
            rule: `Cov <${cutoffCov}% · Pass <${cutoffPass}%`,
            count: counts.criticalRisk || 0,
            color: COLORS.danger,
          },
        ];

        let qy = plotY + 15;
        for (const qr of quadRows) {
          drawDot(qSumX + 4, qy + 4.5, 2.4, qr.color);
          text(qr.label, qSumX + 11, qy, {
            size: 7.4,
            bold: true,
            color: COLORS.ink,
            width: 68,
            lineBreak: false,
          });
          text(String(qr.count), qSumX + qSumW - 24, qy, {
            size: 7.5,
            bold: true,
            color: COLORS.ink,
            width: 24,
            align: "right",
            lineBreak: false,
          });
          text(qr.rule, qSumX + 11, qy + 9.5, {
            size: 6.4,
            color: COLORS.subtle,
            width: qSumW - 14,
            lineBreak: false,
          });
          qy += 23;
        }

        drawLine(qSumX, qy + 2, qSumX + qSumW, qy + 2, COLORS.ruleLight, 0.5);
        text(`Untested / Excluded from Quadrant: ${untestedNodes.length}`, qSumX, qy + 8, {
          size: 7.1,
          bold: true,
          color: COLORS.inkSecondary,
          width: qSumW,
        });
        if (untestedNodes.length > 0) {
          const untestedList = `${untestedNodes
            .slice(0, 4)
            .map((n) => safeText(n.name, 26))
            .join(", ")}${untestedNodes.length > 4 ? ` (+${untestedNodes.length - 4} more)` : ""}`;
          text(untestedList, qSumX, qy + 20, {
            size: 6.7,
            color: COLORS.subtle,
            width: qSumW,
          });
        }

        y += quadBlockH + 8;

        // ── Part B: Project Benchmark Comparison (ONLY when >=1 Doing project has metrics)
        if (benchmarkProjects.length > 0) {
          const topBenchmarks = benchmarkProjects.slice(0, 10);
          const benchRowH = 18;
          const benchNeeded = 32 + topBenchmarks.length * benchRowH + 22;
          ensureSpace(Math.min(benchNeeded, 110));

          const drawBenchmarkHeader = () => {
            text(
              "Project Benchmark Comparison (Active Doing Workspaces Ranked by Coverage)",
              left,
              y,
              {
                size: 8.4,
                bold: true,
                color: COLORS.ink,
                width: width - 110,
              },
            );
            text("Coverage vs. 80% Gate  |  Health", left + width - 140, y + 1, {
              size: 6.8,
              color: COLORS.subtle,
              width: 140,
              align: "right",
              lineBreak: false,
            });
            y += 16;

            // Column sub-labels
            text("Workspace", left, y, { size: 6.6, bold: true, color: COLORS.subtle, width: 156 });
            text("Unified Coverage %", left + 164, y, {
              size: 6.6,
              bold: true,
              color: COLORS.subtle,
              width: 224,
            });
            text("Cov", left + 396, y, {
              size: 6.6,
              bold: true,
              color: COLORS.subtle,
              width: 52,
              align: "right",
            });
            text("Health", left + 458, y, {
              size: 6.6,
              bold: true,
              color: COLORS.subtle,
              width: 65.28,
              align: "right",
            });
            y += 11;
            drawLine(left, y, left + width, y, COLORS.rule, 0.5);
            y += 5;
          };

          drawBenchmarkHeader();

          const bTrackX = left + 164;
          const bTrackW = 224;
          const bTargetX = bTrackX + bTrackW * 0.8;

          topBenchmarks.forEach((bp, idx) => {
            if (y + benchRowH > bottom - 12) {
              addPage(false);
              drawBenchmarkHeader();
            }
            if (idx % 2 === 0) {
              drawRect(left, y - 1, width, benchRowH - 1, COLORS.zebra);
            }
            const covNum =
              bp.unifiedCoveragePct !== null && bp.unifiedCoveragePct !== undefined
                ? Number(bp.unifiedCoveragePct)
                : null;
            const healthNum =
              bp.healthScore !== null && bp.healthScore !== undefined
                ? Number(bp.healthScore)
                : null;
            const barColor =
              covNum !== null && covNum >= 80
                ? COLORS.pass
                : covNum !== null && covNum >= 60
                  ? COLORS.brand
                  : COLORS.amber;

            text(safeText(bp.name, 34), left + 2, y + 3, {
              size: 7.3,
              bold: true,
              color: COLORS.ink,
              width: 156,
              lineBreak: false,
            });
            drawRect(bTrackX, y + 5, bTrackW, 6.5, COLORS.track);
            if (covNum !== null && Number.isFinite(covNum)) {
              drawRect(
                bTrackX,
                y + 5,
                (Math.max(0, Math.min(100, covNum)) / 100) * bTrackW,
                6.5,
                barColor,
              );
            }
            drawDashedLine(bTargetX, y + 2, bTargetX, y + 14, COLORS.pass, 0.8, 2, 1.5);

            text(fmtPct(covNum), left + 396, y + 3, {
              size: 7.3,
              bold: true,
              color: COLORS.ink,
              width: 52,
              align: "right",
              lineBreak: false,
            });
            text(
              healthNum !== null ? `${healthNum}/100` : "—",
              left + 458,
              y + 3,
              {
                size: 7.2,
                color:
                  healthNum === null
                    ? COLORS.subtle
                    : healthNum >= 80
                      ? COLORS.pass
                      : healthNum >= 50
                        ? COLORS.warn
                        : COLORS.danger,
                width: 65.28,
                align: "right",
                lineBreak: false,
              },
            );
            y += benchRowH;
          });

          if (benchmarkProjects.length > 10) {
            text(
              `Showing top 10 of ${benchmarkProjects.length} active measured workspaces; full listing in Project Quality Matrix below.`,
              left,
              y + 3,
              { size: 6.8, color: COLORS.subtle, width },
            );
            y += 14;
          } else {
            y += 10;
          }
        }
      }

      // ── 4. Consolidated Project Quality Matrix ──────────────────────────
      if (sections.projectMatrix) {
        drawSectionHeader(
          "Consolidated Project Quality Matrix",
          "Active VCS/Git branch displayed beneath workspace name. KPI Scope separates Doing (Included) from isolated or backlog workspaces.",
          `${projects.length} workspace(s)`,
        );

        if (projects.length === 0) {
          ensureSpace(34);
          drawLine(left, y, left + width, y, COLORS.ruleLight, 0.5);
          text("No workspaces match this export scope.", left + 4, y + 8, {
            size: 8.2,
            color: COLORS.muted,
            width: width - 8,
          });
          y += 28;
        } else {
          // 10 columns totaling exact width = 523.28pt
          const headers = [
            "Project & Branch",
            "Lifecycle",
            "KPI",
            "Health",
            "Unit",
            "API",
            "E2E",
            "Unified",
            "Tests (Pass%)",
            "Last Run",
          ];
          const colWidths = [119.28, 62, 42, 36, 36, 36, 36, 40, 64, 52];

          const drawTableHeader = () => {
            drawRect(left, y, width, 22, COLORS.tableHeader);
            let x = left;
            headers.forEach((hLabel, idx) => {
              text(hLabel, x + 4, y + 6.5, {
                size: 6.8,
                bold: true,
                color: COLORS.white,
                width: colWidths[idx] - 8,
                align: idx >= 3 ? "right" : "left",
                lineBreak: false,
              });
              x += colWidths[idx];
            });
            y += 22;
          };

          ensureSpace(64);
          drawTableHeader();

          projects.forEach((p, idx) => {
            const nameStr = safeText(p.name, 64);
            const branchStr = safeText(p.branch || "local", 40);
            const nameH = measureHeight(nameStr, 7.3, colWidths[0] - 8, true);
            const branchH = measureHeight(branchStr, 6.4, colWidths[0] - 8, false);
            const projCellH = nameH + branchH + 11;

            const lcLabel = safeText(p.lifecycleLabel || p.lifecycleStatus, 18);
            const lcColor = LIFECYCLE_COLOR_MAP[p.lifecycleStatus] || COLORS.neutral;
            const testsStr =
              (p.executedTests || 0) > 0
                ? `${p.executedTests} (${fmtPct(p.passRatePct)})`
                : "0 (—)";

            const otherCells = [
              lcLabel,
              safeText(p.kpiScope, 12),
              p.healthScore !== null && p.healthScore !== undefined ? `${p.healthScore}` : "—",
              fmtPct(p.unitCoveragePct),
              fmtPct(p.apiCoveragePct),
              fmtPct(p.e2eCoveragePct),
              fmtPct(p.unifiedCoveragePct),
              testsStr,
              fmtDateShort(p.lastExecutedAt),
            ];

            const rowH = Math.max(
              24,
              projCellH,
              ...otherCells.map(
                (cell, oi) =>
                  measureHeight(cell, 7.1, colWidths[oi + 1] - (oi === 0 ? 16 : 8)) + 10,
              ),
            );

            if (y + rowH > bottom) {
              addPage(false);
              drawTableHeader();
            }

            if (idx % 2 === 1) {
              drawRect(left, y, width, rowH, COLORS.zebra);
            }

            // Col 0: Project & Branch stacked cleanly
            text(nameStr, left + 4, y + 4.5, {
              size: 7.3,
              bold: true,
              color: COLORS.ink,
              width: colWidths[0] - 8,
            });
            text(branchStr, left + 4, y + 4.5 + nameH + 1.5, {
              size: 6.4,
              color: COLORS.subtle,
              width: colWidths[0] - 8,
            });

            // Col 1: Lifecycle dot + label
            let x = left + colWidths[0];
            drawDot(x + 7, y + 9.5, 2.2, lcColor);
            text(lcLabel, x + 13, y + 5.5, {
              size: 7,
              color: COLORS.inkSecondary,
              width: colWidths[1] - 16,
              lineBreak: false,
            });

            // Cols 2..9
            x += colWidths[1];
            for (let ci = 2; ci < headers.length; ci++) {
              const val = otherCells[ci - 1];
              let cellColor = COLORS.ink;
              let isBold = false;
              if (ci === 2 && p.kpiScope === "Isolated") cellColor = COLORS.subtle;
              if (ci === 3) {
                isBold = true;
                if (p.healthScore !== null && p.healthScore !== undefined) {
                  cellColor =
                    p.healthScore >= 80
                      ? COLORS.pass
                      : p.healthScore >= 50
                        ? COLORS.warn
                        : COLORS.danger;
                } else {
                  cellColor = COLORS.subtle;
                }
              }
              if (ci === 7) isBold = true;
              if (ci === 9) cellColor = COLORS.muted;

              text(val, x + 4, y + 5.5, {
                size: 7.1,
                bold: isBold,
                color: cellColor,
                width: colWidths[ci] - 8,
                align: ci >= 3 ? "right" : "left",
                lineBreak: false,
              });
              x += colWidths[ci];
            }

            y += rowH;
            drawLine(left, y, left + width, y, COLORS.ruleLight, 0.45);
          });

          y += 14;
        }
      }

      // ── 5. Quality Audit Findings & Action Plan ─────────────────────────
      if (sections.priorityFindings) {
        drawSectionHeader(
          "Quality Audit Findings & Action Plan",
          "Key quality gaps and recommended next steps based on current workspace metrics.",
          `${findings.length} finding(s)`,
        );

        if (findings.length === 0) {
          ensureSpace(32);
          text("No quality gaps identified for this export scope.", left + 4, y + 6, {
            size: 8.2,
            color: COLORS.muted,
            width: width - 8,
          });
          y += 24;
        } else {
          // 4 structured columns totaling 523.28pt
          const fHeaders = [
            "Priority",
            "Scope / Project",
            "Observation",
            "Recommended Action",
          ];
          const fWidths = [54, 100, 204, 165.28];

          const drawFindingsHeader = () => {
            drawRect(left, y, width, 21, COLORS.tableHeader);
            let x = left;
            fHeaders.forEach((fh, idx) => {
              text(fh, x + 5, y + 6, {
                size: 6.8,
                bold: true,
                color: COLORS.white,
                width: fWidths[idx] - 10,
                align: "left",
                lineBreak: false,
              });
              x += fWidths[idx];
            });
            y += 21;
          };

          ensureSpace(58);
          drawFindingsHeader();

          findings.forEach((item, idx) => {
            const pStyle = PRIORITY_STYLE_MAP[item.severity] || PRIORITY_STYLE_MAP.INFO;
            const scopeStr = item.projectName
              ? safeText(item.projectName, 64)
              : "Workspace";
            const obsTitle = safeText(item.title, 180, "");
            const obsDetail = safeText(item.detail, 320, "");
            const recStr = safeText(item.recommendation, 260);

            const hScope = measureHeight(scopeStr, 7.2, fWidths[1] - 10, true);
            const hObsTitle = obsTitle
              ? measureHeight(obsTitle, 7.4, fWidths[2] - 10, true)
              : 0;
            const hObsDetail = obsDetail
              ? measureHeight(obsDetail, 7.0, fWidths[2] - 10, false)
              : 0;
            const hRec = measureHeight(recStr, 7.1, fWidths[3] - 10, false);

            const obsTotalH =
              hObsTitle + (obsTitle && obsDetail ? 3 : 0) + hObsDetail;
            const rowH = Math.max(24, hScope + 10, obsTotalH + 10, hRec + 10);

            if (y + rowH > bottom) {
              addPage(false);
              drawFindingsHeader();
            }

            if (idx % 2 === 1) {
              drawRect(left, y, width, rowH, COLORS.zebra);
            }

            // Priority cell: crisp dot + restrained semantic text
            drawDot(left + 8, y + 9.5, 2.3, pStyle.color);
            text(pStyle.label, left + 14, y + 5.5, {
              size: 7.2,
              bold: true,
              color: pStyle.color,
              width: fWidths[0] - 18,
              lineBreak: false,
            });

            // Scope / Project
            let x = left + fWidths[0];
            text(scopeStr, x + 5, y + 5.5, {
              size: 7.2,
              bold: Boolean(item.projectName),
              color: item.projectName ? COLORS.ink : COLORS.muted,
              width: fWidths[1] - 10,
            });

            // Observation (Title + Detail)
            x += fWidths[1];
            if (obsTitle) {
              text(obsTitle, x + 5, y + 5.2, {
                size: 7.4,
                bold: true,
                color: COLORS.ink,
                width: fWidths[2] - 10,
              });
            }
            if (obsDetail) {
              text(
                obsDetail,
                x + 5,
                y + 5.2 + (obsTitle ? hObsTitle + 3 : 0),
                {
                  size: 7.0,
                  color: COLORS.muted,
                  width: fWidths[2] - 10,
                },
              );
            }

            // Recommended Action
            x += fWidths[2];
            text(recStr, x + 5, y + 5.5, {
              size: 7.1,
              color: COLORS.inkSecondary,
              width: fWidths[3] - 10,
            });

            y += rowH;
            drawLine(left, y, left + width, y, COLORS.ruleLight, 0.45);
          });

          y += 14;
        }
      }

      // ── 6. Appendix — Methodology & Metric Definitions ──────────────────
      const rawWeights = meta.methodology?.coverageWeights || "50% Unit / 30% API / 20% E2E";
      const coverageWeightsText = /re-normalized/i.test(rawWeights)
        ? rawWeights
        : `${rawWeights} (re-normalized across measured layers only)`;
      const appendixItems = [
        [
          "Unified Coverage",
          `Weighted composite of ${coverageWeightsText}, evaluated against an ${meta.methodology?.coverageTargetPct ?? 80}% quality gate.`,
        ],
        [
          "Health Score & Pass Rate",
          `Composite of layer Pass Rate (${meta.methodology?.passRateFormula || "Passed / (Passed + Failed)"}) and measured coverage, minus a failure penalty (2 pts per failed test, capped at 15).`,
        ],
        [
          "Risk Quadrant Thresholds",
          `Evaluates tested Doing workspaces against ${risk.coverageCutoff ?? 70}% Unified Coverage and ${risk.passRateCutoff ?? 85}% Pass Rate. Untested active workspaces remain excluded.`,
        ],
        [
          "Time Saved & KPI Scope",
          `${meta.methodology?.roiMethodologyNote || "Estimated against CovAI internal baseline (Unit 2m, API 5m, E2E 8m, AI authoring 15m/test)."} Only Doing workspaces feed Executive KPIs; Not Started, Paused, Completed, and Cancelled states remain isolated.`,
        ],
      ];

      const appColW = (width - 20) / 2;
      const appHeights = appendixItems.map(
        ([lbl, body]) => measureHeight(`${lbl}: ${body}`, 7.1, appColW, false) + 5,
      );
      const appBlockH =
        26 +
        Math.max(appHeights[0], appHeights[1]) +
        Math.max(appHeights[2], appHeights[3]) +
        8;

      ensureSpace(appBlockH);
      drawLine(left, y, left + width, y, COLORS.rule, 0.65);
      y += 8;
      text("Appendix — Methodology & Metric Definitions", left, y, {
        size: 8.6,
        bold: true,
        color: COLORS.ink,
        width,
      });
      y += 14;

      const drawAppCell = (item, x, top) => {
        const [lbl, body] = item;
        text(`${lbl}:`, x, top, { size: 7.1, bold: true, color: COLORS.inkSecondary, width: appColW });
        const lblH = measureHeight(`${lbl}:`, 7.1, appColW, true);
        text(body, x, top + lblH + 1.5, { size: 7.0, color: COLORS.muted, width: appColW });
      };

      const row1HApp = Math.max(
        measureHeight(appendixItems[0][1], 7.0, appColW) + 14,
        measureHeight(appendixItems[1][1], 7.0, appColW) + 14,
      );
      drawAppCell(appendixItems[0], left, y);
      drawAppCell(appendixItems[1], left + appColW + 20, y);
      y += row1HApp + 6;
      drawAppCell(appendixItems[2], left, y);
      drawAppCell(appendixItems[3], left + appColW + 20, y);

      // ── 7. Page Footer on Every Page (bufferPages: true) ────────────────
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        drawLine(left, PAGE.footerRuleY, left + width, PAGE.footerRuleY, COLORS.rule, 0.5);
        text(
          safeText(
            `CovAI · Portfolio Quality & Coverage Report · ${meta.scopeLabel || "Active KPI Scope"} · ${meta.generatedAtFormatted || ""}`,
            105,
          ),
          left,
          PAGE.footerTextY,
          { size: 7, color: COLORS.subtle, width: 410, lineBreak: false },
        );
        text(`Page ${i - range.start + 1} of ${range.count}`, left + 412, PAGE.footerTextY, {
          size: 7.2,
          bold: true,
          color: COLORS.muted,
          width: width - 412,
          align: "right",
          lineBreak: false,
        });
      }

      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
