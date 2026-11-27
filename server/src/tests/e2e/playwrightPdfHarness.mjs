import fs from "node:fs";
import path from "node:path";
import { chromium } from "../../../node_modules/playwright/index.mjs";
import * as pdfjs from "../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "../../../node_modules/@napi-rs/canvas/index.js";

export const A4_VIEWPORT = { width: 794, height: 1123 };
// Printable A4 height at 96 DPI with 9mm top/bottom margins: (297 - 18) * 96 / 25.4 ≈ 1054.5px
export const A4_PRINTABLE_HEIGHT_PX = 1054.5;
// Printable A4 width at 96 DPI with 10mm left/right margins: (210 - 20) * 96 / 25.4 ≈ 718.1px
export const A4_PRINTABLE_WIDTH_PX = 718.1;

let sharedBrowserPromise = null;

class NodeCanvasFactory {
  create(width, height) {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    const canvas = createCanvas(w, h);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = Math.max(1, Math.ceil(width));
    canvasAndContext.canvas.height = Math.max(1, Math.ceil(height));
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

export async function getSharedBrowser() {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = (async () => {
      const channels = ["msedge", "chrome", undefined];
      let lastErr = null;
      for (const channel of channels) {
        try {
          const opts = channel
            ? { channel, headless: true }
            : { headless: true };
          return await chromium.launch(opts);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("Unable to launch Playwright Chromium/Edge/Chrome browser.");
    })();
  }
  return sharedBrowserPromise;
}

export async function closeSharedBrowser() {
  if (!sharedBrowserPromise) return;
  try {
    const browser = await sharedBrowserPromise;
    await browser.close();
  } catch (err) {
    console.warn("[playwrightPdfHarness] Error closing browser:", err?.message);
  } finally {
    sharedBrowserPromise = null;
  }
}

function collectDomMetricsInBrowser() {
  const chartsGrid2x2Count = document.querySelectorAll(".charts-grid-2x2").length;
  const chartPageEls = [...document.querySelectorAll("[data-chart-page]")];
  const chartPages = chartPageEls.map((el) => {
    const svgs = [...el.querySelectorAll("svg")];
    return {
      pageAttr: el.getAttribute("data-chart-page"),
      svgCount: svgs.length,
      diagramIds: svgs.map((s) => s.getAttribute("data-diagram-id") || ""),
    };
  });

  const allSvgs = [...document.querySelectorAll("svg")];
  const orphanSvgs = allSvgs.filter((s) => !s.closest("[data-chart-page]")).length;

  const svgMetrics = allSvgs.map((svg) => {
    const vbRaw = svg.getAttribute("viewBox") || "";
    const vbParts = vbRaw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const vbWidth = Number.isFinite(vbParts[2]) ? vbParts[2] : 0;
    const vbHeight = Number.isFinite(vbParts[3]) ? vbParts[3] : 0;
    const rect = svg.getBoundingClientRect();

    const textBoxes = [];
    for (const t of svg.querySelectorAll("text")) {
      const txt = (t.textContent || "").trim();
      if (!txt) continue;
      const r = t.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      textBoxes.push({
        text: txt,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      });
    }

    const textOverlaps = [];
    for (let i = 0; i < textBoxes.length; i++) {
      for (let j = i + 1; j < textBoxes.length; j++) {
        const a = textBoxes[i];
        const b = textBoxes[j];
        const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapW > 1.5 && overlapH > 1.5) {
          textOverlaps.push({
            a: a.text,
            b: b.text,
            overlapW: Number(overlapW.toFixed(1)),
            overlapH: Number(overlapH.toFixed(1)),
          });
        }
      }
    }

    const clippedTexts = [];
    if (rect.width > 0 && rect.height > 0) {
      for (const tb of textBoxes) {
        if (
          tb.left < rect.left - 1.5 ||
          tb.right > rect.right + 1.5 ||
          tb.top < rect.top - 1.5 ||
          tb.bottom > rect.bottom + 1.5
        ) {
          clippedTexts.push({
            text: tb.text,
            tb: { left: tb.left, right: tb.right, top: tb.top, bottom: tb.bottom },
            svgRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          });
        }
      }
    }

    const hasGradient = Boolean(
      svg.querySelector("linearGradient, radialGradient")
    );

    return {
      diagramId: svg.getAttribute("data-diagram-id") || "",
      viewBox: vbRaw,
      vbWidth,
      vbHeight,
      rect: {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      },
      textCount: textBoxes.length,
      textOverlaps,
      clippedTexts,
      hasGradient,
      hasAriaLabel: Boolean(svg.getAttribute("aria-label")),
      role: svg.getAttribute("role") || "",
    };
  });

  const pageOneEl = document.querySelector(".page-one");
  const pageOneRect = pageOneEl ? pageOneEl.getBoundingClientRect() : null;
  const footnoteEl = document.querySelector(".page1-footnote");
  const footnoteRect = footnoteEl ? footnoteEl.getBoundingClientRect() : null;

  const badges = [...document.querySelectorAll(".badge")].map((el) => {
    const r = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const lineCount = range.getClientRects().length;
    return {
      text: (el.textContent || "").trim(),
      height: r.height,
      width: r.width,
      lineCount,
      wrapped: r.height >= 26 || lineCount > 1,
    };
  });

  const keyFindingsSec = document.querySelector("#sec-key-findings");
  const keyFindingsOverflowCells = [];
  const keyFindingsWrappedTokens = [];
  if (keyFindingsSec) {
    const headers = [...keyFindingsSec.querySelectorAll("thead th")];
    for (const th of headers) {
      const txt = (th.textContent || "").trim();
      if (th.scrollWidth > th.clientWidth + 1) {
        keyFindingsOverflowCells.push({ tag: "TH", text: txt, scrollW: th.scrollWidth, clientW: th.clientWidth });
      }
      if (/^(Tier|Framework|Status|Pass Rate|Duration|Avg Latency)$/i.test(txt)) {
        const range = document.createRange();
        range.selectNodeContents(th);
        const rects = range.getClientRects();
        if (rects.length > 1) {
          keyFindingsWrappedTokens.push({ tag: "TH", text: txt, lines: rects.length });
        }
      }
    }
    const firstTableCells = [...keyFindingsSec.querySelectorAll("table:first-of-type tbody td")];
    for (const td of firstTableCells) {
      const txt = (td.textContent || "").trim();
      if (/^(Vitest|Jest|Supertest|Playwright|Cypress)$/i.test(txt)) {
        if (td.scrollWidth > td.clientWidth + 1) {
          keyFindingsOverflowCells.push({ tag: "TD", text: txt, scrollW: td.scrollWidth, clientW: td.clientWidth });
        }
        const range = document.createRange();
        range.selectNodeContents(td);
        const rects = range.getClientRects();
        if (rects.length > 1) {
          keyFindingsWrappedTokens.push({ tag: "TD", text: txt, lines: rects.length });
        }
      }
    }
  }

  const overflowingTables = [...document.querySelectorAll("table")]
    .map((tbl, idx) => ({
      index: idx,
      scrollWidth: tbl.scrollWidth,
      clientWidth: tbl.clientWidth,
    }))
    .filter((t) => t.scrollWidth > t.clientWidth + 2);

  const headerEl = document.querySelector("h1");
  const provenanceEl = document.querySelector(".provenance");
  const toolbarEl = document.querySelector(".report-toolbar, .toolbar");
  const toolbarBtn = toolbarEl ? toolbarEl.querySelector("button") : null;

  const bodyText = document.body?.innerText || "";
  const nanMatches = bodyText.match(/\bNaN\b/g) || [];
  const undefinedMatches = bodyText.match(/\bundefined\b/g) || [];

  return {
    chartsGrid2x2Count,
    chartPages,
    totalSvgs: allSvgs.length,
    orphanSvgs,
    svgMetrics,
    pageOne: pageOneRect
      ? {
          exists: true,
          height: pageOneRect.height,
          top: pageOneRect.top,
          bottom: pageOneRect.bottom,
          hasFollowup: pageOneEl.classList.contains("has-followup"),
        }
      : { exists: false, height: 0, top: 0, bottom: 0, hasFollowup: false },
    pageOneFootnote: footnoteRect
      ? {
          exists: true,
          top: footnoteRect.top,
          bottom: footnoteRect.bottom,
        }
      : { exists: false, top: 0, bottom: 0 },
    badges,
    keyFindingsOverflowCells,
    keyFindingsWrappedTokens,
    overflowingTables,
    headingRect: headerEl ? headerEl.getBoundingClientRect() : null,
    provenanceRect: provenanceEl ? provenanceEl.getBoundingClientRect() : null,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    toolbarVisible: Boolean(toolbarEl && toolbarEl.getBoundingClientRect().height > 0),
    toolbarButtonText: toolbarBtn ? (toolbarBtn.textContent || "").trim() : "",
    scriptCount: document.querySelectorAll("script").length,
    nanMatches,
    undefinedMatches,
    bodyText,
  };
}

export async function auditStandaloneHtml(
  html,
  { viewport = { width: 1280, height: 900 }, screenshotPath = null } = {}
) {
  const browser = await getSharedBrowser();
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    let dialogTriggered = false;
    page.on("dialog", async (dialog) => {
      dialogTriggered = true;
      await dialog.dismiss();
    });
    await page.setContent(html, { waitUntil: "load" });
    const metrics = await page.evaluate(collectDomMetricsInBrowser);
    if (screenshotPath) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    return {
      ...metrics,
      dialogTriggered,
    };
  } finally {
    await context.close();
  }
}

export async function auditPrintPdfHtml(
  pdfHtml,
  { screenshotDir = null, screenshotName = "report" } = {}
) {
  const browser = await getSharedBrowser();
  const context = await browser.newContext({ viewport: A4_VIEWPORT });
  try {
    const page = await context.newPage();
    let dialogTriggered = false;
    page.on("dialog", async (dialog) => {
      dialogTriggered = true;
      await dialog.dismiss();
    });
    await page.emulateMedia({ media: "print" });
    await page.setContent(pdfHtml, { waitUntil: "load" });
    const metrics = await page.evaluate(collectDomMetricsInBrowser);

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "9mm", right: "10mm", bottom: "9mm", left: "10mm" },
    });

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      verbosity: 0,
    });
    const pdfDoc = await loadingTask.promise;
    const pageTexts = [];
    const canvasFactory = new NodeCanvasFactory();

    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      fs.writeFileSync(path.join(screenshotDir, `${screenshotName}.pdf`), pdfBuffer);
    }

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const pdfPage = await pdfDoc.getPage(p);
      const textContent = await pdfPage.getTextContent();
      const textStr = textContent.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pageTexts.push(textStr);

      if (screenshotDir) {
        const vp = pdfPage.getViewport({ scale: 1.5 });
        const { canvas, context: ctx } = canvasFactory.create(vp.width, vp.height);
        await pdfPage.render({
          canvasContext: ctx,
          viewport: vp,
          canvasFactory,
        }).promise;
        const pngBuf = canvas.toBuffer("image/png");
        fs.writeFileSync(
          path.join(screenshotDir, `${screenshotName}-pdf-page-${p}.png`),
          pngBuf
        );
        canvasFactory.destroy({ canvas, context: ctx });
      }
    }

    await pdfDoc.destroy();

    return {
      ...metrics,
      dialogTriggered,
      pdfByteLength: pdfBuffer.length,
      pdfNumPages: pdfDoc.numPages,
      pdfPageTexts: pageTexts,
      pageOneFillRatio: metrics.pageOne.height / A4_PRINTABLE_HEIGHT_PX,
      pageOneFitsA4: metrics.pageOne.bottom <= A4_PRINTABLE_HEIGHT_PX + 1,
      footnoteFitsPageOne: metrics.pageOneFootnote.exists
        ? metrics.pageOneFootnote.bottom <= A4_PRINTABLE_HEIGHT_PX + 1
        : false,
    };
  } finally {
    await context.close();
  }
}
