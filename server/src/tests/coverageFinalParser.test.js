import { parseCoverageFinal } from "../services/coverageFinalParser.service.js";
import prisma from "../config/prisma.js";
import fs from "fs";
import path from "path";

jest.mock("../config/prisma.js", () => ({
    coverageFunction: {
        upsert: jest.fn()
    }
}));

jest.mock("fs");

describe("coverageFinalParser", () => {
    const snapshotId = "test-snapshot-id";
    const coverageDir = "/tmp/coverage";

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should parse coverage-final.json and upsert functions", async () => {
        const mockCoverage = {
            "/app/src/test.js": {
                fnMap: {
                    "1": {
                        name: "testFunc",
                        decl: { start: { line: 1 }, end: { line: 5 } }
                    }
                },
                f: { "1": 10 }
            }
        };

        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify(mockCoverage));

        await parseCoverageFinal(coverageDir, snapshotId);

        expect(prisma.coverageFunction.upsert).toHaveBeenCalledWith({
            where: {
                snapshotId_filePath_functionName_startLine: {
                    snapshotId,
                    filePath: "app/src/test.js",
                    functionName: "testFunc",
                    startLine: 1
                }
            },
            create: {
                snapshotId,
                filePath: "app/src/test.js",
                functionName: "testFunc",
                startLine: 1,
                endLine: 5,
                hit: 10
            },
            update: {
                hit: 10
            }
        });
    });
});