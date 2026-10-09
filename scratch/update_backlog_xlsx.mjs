import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "D:/HuuThuan - Project/NCKH/CovAI";
const inputPath = `${root}/temp/C1SE.20_ProductBacklog-UserStory_Storelens_v1.1.xlsx`;
const outputPath = `${root}/scratch/C1SE.20_ProductBacklog-UserStory_Storelens_v1.1.final.xlsx`;

const estimateById = {
  "PB-01": 36, "PB-02": 52, "PB-03": 56, "PB-04": 28, "PB-05": 60,
  "PB-06": 36, "PB-07": 68, "PB-08": 64, "PB-09": 64, "PB-10": 64,
  "PB-11": 80, "PB-12": 64, "PB-13": 64, "PB-14": 56, "PB-15": 48,
  "PB-16": 56, "PB-17": 64, "PB-18": 48, "PB-19": 40, "PB-20": 40,
  "PB-21": 32, "PB-22": 32, "PB-23": 48, "PB-24": 56, "PB-25": 40,
  "PB-26": 56, "PB-27": 48, "PB-28": 48, "PB-29": 40, "PB-30": 96,
  "PB-31": 72, "PB-32": 144, "PB-33": 120,
};

const sprintById = {};
for (const id of Object.keys(estimateById)) {
  const n = Number(id.slice(3));
  sprintById[id] = n <= 7 ? "Sprint 1" : n <= 12 ? "Sprint 2" : n <= 18 ? "Sprint 3" : n <= 22 ? "Sprint 4" : n <= 29 ? "Sprint 5" : n <= 31 ? "Sprint 6" : "Sprint 7";
}

const adminIds = new Set(["PB-20", "PB-31", "PB-32", "PB-33"]);
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("Product Backlog");

const rows = sheet.getRange("B7:O40").values;
const ids = rows.slice(1).map((row) => String(row[0] ?? "").trim()).filter(Boolean);
if (ids.length !== 33 || ids.some((id) => !(id in estimateById))) {
  throw new Error(`Expected PB-01..PB-33 in rows 8:40; found ${ids.join(", ")}`);
}

const rowById = new Map();
for (let i = 0; i < ids.length; i += 1) rowById.set(ids[i], 8 + i);
const setCell = (column, row, value) => {
  sheet.getRange(`${column}${row}`).values = [[value]];
};

for (const [id, row] of rowById) {
  setCell("D", row, adminIds.has(id) ? "Admin" : "User");
  setCell("M", row, sprintById[id]);
  setCell("N", row, estimateById[id]);
}

const pb10row = rowById.get("PB-10");
const pb10 = String(sheet.getRange(`G${pb10row}`).values[0][0] ?? "");
setCell("G", pb10row, pb10.replace(/, Mocha/gi, ""));

const pb11row = rowById.get("PB-11");
const pb11 = String(sheet.getRange(`G${pb11row}`).values[0][0] ?? "");
setCell("G", pb11row, pb11
  .replace(/max 2 CPU cores, max 2GB RAM, 180-second timeout/gi, "max 1 vCPU, max 1GB RAM, 30-second timeout")
  .replace(/2 CPU cores/gi, "1 vCPU")
  .replace(/2GB RAM/gi, "1GB RAM")
  .replace(/180-second timeout/gi, "30-second timeout"));
const pb11remarks = String(sheet.getRange(`H${pb11row}`).values[0][0] ?? "");
if (!/1 vCPU.*1GB RAM.*30-second timeout/i.test(pb11remarks)) {
  setCell("H", pb11row, `${pb11remarks} Project Plan constraint: <=1 vCPU, <=1GB RAM, 30-second timeout.`);
}

const pb28row = rowById.get("PB-28");
setCell("G", pb28row, [
  "1. Evaluates Layer 1 Core Criteria: Correctness %, Faithfulness %, Relevance %, Completeness %, Hallucination %, Consistency %, Context Retention %, Clarification %, Appropriate Refusal %, Safety %, Privacy %, Latency, and Cost where measurable.",
  "2. Evaluates Layer 2 Task Module Criteria: Knowledge Q&A source accuracy and citation presence; Usage Guidance UI step correctness and navigation completeness; Action/Tool tool selection accuracy, parameter precision, confirmation compliance, and duplicate/forbidden action checks.",
  "3. Evaluates Layer 3 Project Rules: compliance with verified ground-truth constraints.",
  "4. Computes Overall Trustworthiness Index (0-100) using weighted aggregation.",
  "5. Stores granular sub-scores and violation tags for every scenario.",
].join("\n"));

const sprintTotals = new Map();
for (const [id, row] of rowById) {
  const sprint = sprintById[id];
  sprintTotals.set(sprint, (sprintTotals.get(sprint) ?? 0) + Number(sheet.getRange(`N${row}`).values[0][0] ?? 0));
}
const expectedTotals = { "Sprint 1": 336, "Sprint 2": 336, "Sprint 3": 336, "Sprint 4": 144, "Sprint 5": 336, "Sprint 6": 168, "Sprint 7": 264 };
for (const [sprint, expected] of Object.entries(expectedTotals)) {
  if (sprintTotals.get(sprint) !== expected) throw new Error(`${sprint}: expected ${expected}, got ${sprintTotals.get(sprint)}`);
}

workbook.recalculate();
const formulaCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
});
await fs.writeFile(`${root}/scratch/xlsx_final_inspect.ndjson`, formulaCheck.ndjson ?? String(formulaCheck), "utf8");
const preview = await workbook.render({ sheetName: "Product Backlog", range: "A1:O42", scale: 1.5, format: "png" });
await fs.writeFile(`${root}/scratch/xlsx_final_preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ ids: ids.length, sprintTotals: Object.fromEntries(sprintTotals), outputPath, formulaCheck: formulaCheck.ndjson ?? String(formulaCheck) }));
