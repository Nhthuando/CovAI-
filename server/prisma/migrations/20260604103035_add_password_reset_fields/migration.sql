-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordResetExpires" TIMESTAMP(3),
ADD COLUMN     "passwordResetToken" TEXT;
