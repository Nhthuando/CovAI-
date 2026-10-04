import fs from "fs";

const d = JSON.parse(fs.readFileSync("/tmp/jest_test_out.json", "utf8"));
let totalStmts = 0;
let coveredStmts = 0;
let totalBranches = 0;
let coveredBranches = 0;
let totalFuncs = 0;
let coveredFuncs = 0;
let totalLines = 0;
let coveredLines = 0;

console.log("=== Files with < 98% statement coverage ===");
for (const [file, data] of Object.entries(d.coverageMap)) {
  const s = data.s || {};
  let fStmts = 0, fCovStmts = 0;
  for (const k of Object.keys(s)) {
    totalStmts++; fStmts++;
    if (s[k] > 0) { coveredStmts++; fCovStmts++; }
  }

  const b = data.b || {};
  let fBranches = 0, fCovBranches = 0;
  for (const k of Object.keys(b)) {
    for (const hit of b[k]) {
      totalBranches++; fBranches++;
      if (hit > 0) { coveredBranches++; fCovBranches++; }
    }
  }

  const f = data.f || {};
  let fFuncs = 0, fCovFuncs = 0;
  for (const k of Object.keys(f)) {
    totalFuncs++; fFuncs++;
    if (f[k] > 0) { coveredFuncs++; fCovFuncs++; }
  }

  const statementMap = data.statementMap || {};
  const coveredLinesSet = new Set();
  const allLinesSet = new Set();
  for (const [k, loc] of Object.entries(statementMap)) {
    const line = loc.start?.line;
    if (line) {
      allLinesSet.add(line);
      if (s[k] > 0) coveredLinesSet.add(line);
    }
  }
  totalLines += allLinesSet.size;
  coveredLines += coveredLinesSet.size;

  const pct = fStmts > 0 ? (fCovStmts / fStmts * 100).toFixed(1) : "100";
  if (Number(pct) < 98) {
    const shortFile = file.replace(/.*\/repo\//, "");
    console.log(`- ${shortFile}: ${pct}% statements (${fCovStmts}/${fStmts})`);
  }
}

console.log("\n=== TOTALS ===");
console.log(`Statement coverage: ${(coveredStmts / totalStmts * 100).toFixed(1)}% (${coveredStmts} / ${totalStmts} statements)`);
console.log(`Branch coverage: ${(coveredBranches / totalBranches * 100).toFixed(1)}% (${coveredBranches} / ${totalBranches} branches)`);
console.log(`Function coverage: ${(coveredFuncs / totalFuncs * 100).toFixed(1)}% (${coveredFuncs} / ${totalFuncs} functions)`);
console.log(`Line coverage: ${(coveredLines / totalLines * 100).toFixed(1)}% (${coveredLines} / ${totalLines} lines)`);
