import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "D:/HuuThuan - Project/NCKH/CovAI";
const inputPath = `${root}/temp/C1SE.20_ProductBacklog-UserStory_Storelens_v1.1.xlsx`;
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({
  kind: "workbook,sheet,table,region,formula,computedStyle,drawing",
  maxChars: 12000,
  tableMaxRows: 45,
  tableMaxCols: 15,
  tableMaxCellChars: 120,
});
await fs.writeFile(`${root}/scratch/xlsx_inspect.ndjson`, summary.ndjson ?? String(summary), "utf8");
const sheet = workbook.worksheets.getItem("Product Backlog");
const preview = await workbook.render({sheetName: "Product Backlog", range: "A1:M42", scale: 1.5, format: "png"});
await fs.writeFile(`${root}/scratch/xlsx_preview.png`, new Uint8Array(await preview.arrayBuffer()));
console.log(summary.ndjson ?? summary);
