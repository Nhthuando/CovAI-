-- CreateTable
CREATE TABLE "AiTestResult" (
    "id" TEXT NOT NULL,
    "aiTestId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTestResult_aiTestId_key" ON "AiTestResult"("aiTestId");

-- AddForeignKey
ALTER TABLE "AiTestResult" ADD CONSTRAINT "AiTestResult_aiTestId_fkey" FOREIGN KEY ("aiTestId") REFERENCES "AiTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
