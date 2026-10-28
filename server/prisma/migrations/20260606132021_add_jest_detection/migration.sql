-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "hasJest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jestCommand" TEXT;

-- AlterTable
ALTER TABLE "ProjectSnapshot" ADD COLUMN     "hasJest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jestCommand" TEXT;
