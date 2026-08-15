# Project structure analysis migration runbook

1. Apply `20260804120000_add_analysis_job_type`; it only adds the PostgreSQL enum value.
2. Apply `20260804120100_add_project_structure_analysis`, then regenerate Prisma Client.
3. Run the duplicate preflight in [project-structure-analysis-index.sql](../../server/prisma/operations/project-structure-analysis-index.sql). It must return no rows.
4. Execute the concurrent partial-index statement outside a transaction and verify no invalid index remains. Only then enable the application feature.

If concurrent index creation fails, drop the invalid index concurrently, resolve active duplicates, and retry. Roll back code or disable the feature if needed; do not remove the `ANALYSIS` enum value, table, or index automatically.
