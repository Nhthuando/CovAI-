import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";

const prismaDir = path.resolve(process.cwd(), "prisma");
const enumMigration = fs.readFileSync(path.join(prismaDir, "migrations", "20260804120000_add_analysis_job_type", "migration.sql"), "utf8");
const schemaMigration = fs.readFileSync(path.join(prismaDir, "migrations", "20260804120100_add_project_structure_analysis", "migration.sql"), "utf8");
const operations = fs.readFileSync(path.join(prismaDir, "operations", "project-structure-analysis-index.sql"), "utf8");

describe("project structure migration contract", () => {
  it("keeps enum expansion isolated and ordered before the table migration", () => {
    expect(enumMigration).toMatch(/ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ANALYSIS'/);
    expect(enumMigration).not.toMatch(/CREATE TABLE|CREATE INDEX/);
    expect(schemaMigration).toMatch(/CREATE TABLE "ProjectStructureAnalysis"/);
    expect(schemaMigration).toMatch(/ON DELETE CASCADE/);
  });

  it("defines the active analysis partial unique index and recovery instructions", () => {
    expect(operations).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY/);
    expect(operations).toMatch(/"type" = 'ANALYSIS'/);
    expect(operations).toMatch(/"snapshotId" IS NOT NULL/);
    expect(operations).toMatch(/"status" IN \('QUEUED', 'RUNNING'\)/);
    expect(operations).toMatch(/DROP INDEX CONCURRENTLY/);
  });
});
