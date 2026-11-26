import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(serverRoot, ".env") });

const MIGRATION_PATH = path.join(
  serverRoot,
  "prisma",
  "migrations",
  "20261127000000_version_control_separation_and_snapshot_vcs",
  "migration.sql",
);

/**
 * Splits SQL script into top-level statements while preserving DO $$ ... END $$; blocks.
 */
export function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let inDollarBlock = false;
  let inSingleQuote = false;

  const lines = sqlText.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!inDollarBlock && !inSingleQuote && (!trimmed || trimmed.startsWith("--"))) {
      continue;
    }

    for (let i = 0; i < rawLine.length; i += 1) {
      const ch = rawLine[i];
      const next = rawLine[i + 1];

      if (!inDollarBlock && ch === "'") {
        if (inSingleQuote && next === "'") {
          current += "''";
          i += 1;
          continue;
        }
        inSingleQuote = !inSingleQuote;
        current += ch;
        continue;
      }

      if (!inSingleQuote && ch === "$" && next === "$") {
        inDollarBlock = !inDollarBlock;
        current += "$$";
        i += 1;
        continue;
      }

      if (!inDollarBlock && !inSingleQuote && ch === ";") {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = "";
        continue;
      }

      current += ch;
    }
    current += "\n";
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const statements = splitSqlStatements(sql);

  console.log(
    `[applyVersionControlMigration] Mode: ${apply ? "APPLY" : "DRY-RUN"} | Statements: ${statements.length}`,
  );

  if (!apply) {
    statements.forEach((stmt, idx) => {
      const preview = stmt.replace(/\s+/g, " ").slice(0, 96);
      console.log(`  [${idx + 1}/${statements.length}] ${preview}`);
    });
    console.log("Pass --apply to execute idempotent statements against DATABASE_URL.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in server/.env or environment.");
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i];
      await pool.query(stmt);
      const preview = stmt.replace(/\s+/g, " ").slice(0, 72);
      console.log(`  [OK ${i + 1}/${statements.length}] ${preview}`);
    }
    console.log("[applyVersionControlMigration] Completed safely.");
  } finally {
    await pool.end();
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  main().catch((err) => {
    console.error("[applyVersionControlMigration] Failed:", err);
    process.exit(1);
  });
}
