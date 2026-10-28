-- PostgreSQL enum values must be introduced in their own committed migration.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ANALYSIS';
