import fs from "fs";
import path from "path";

const snapDir = "/app/storage/projects/cmus894xa00002ho2fwzkckq2/github/1791021997106/repo";
const covSummaryPath = path.join(snapDir, "coverage", "coverage-summary.json");

if (fs.existsSync(covSummaryPath)) {
  const summary = JSON.parse(fs.readFileSync(covSummaryPath, "utf8"));
  console.log("=== Coverage by File in Repo ===");
  const files = [];
  for (const [filePath, data] of Object.entries(summary)) {
    if (filePath === "total") continue;
    files.push({
      file: filePath.replace(snapDir + "/", ""),
      stmts: data.statements.pct,
      coveredStmts: data.statements.covered,
      totalStmts: data.statements.total,
      branches: data.branches.pct,
      coveredBranches: data.branches.covered,
      totalBranches: data.branches.total,
      lines: data.lines.pct
    });
  }
  files.sort((a, b) => a.stmts - b.stmts);
  for (const f of files) {
    console.log(`${f.file}: stmts=${f.stmts}% (${f.coveredStmts}/${f.totalStmts}), branches=${f.branches}% (${f.coveredBranches}/${f.totalBranches}), lines=${f.lines}%`);
  }
} else {
  console.log("No coverage-summary.json found");
}
