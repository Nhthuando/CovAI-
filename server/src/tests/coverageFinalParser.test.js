import { jest } from "@jest/globals";

const prismaMock = {
    coverageFunction: {
        upsert: jest.fn().mockResolvedValue({ id: "func-1" })
    }
};

const fsMock = {
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    promises: {
        readFile: jest.fn()
    }
};

jest.unstable_mockModule("../config/prisma.js", () => ({
    default: prismaMock
}));

jest.unstable_mockModule("fs", () => ({
    default: fsMock,
    ...fsMock
}));

const { parseCoverageFinal } = await import("../services/coverageFinalParser.service.js");
const prisma = prismaMock;
const fs = fsMock;

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