import { describe, it, beforeEach, afterEach, jest } from '@jest/globals';

jest.unstable_mockModule("fs", () => ({
    default: {
        existsSync: jest.fn(),
        statSync: jest.fn(),
        readFileSync: jest.fn(),
    }
}));
jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({
    dockerRunner: { run: jest.fn() }
}));
jest.unstable_mockModule("../services/job.service.js", () => ({
    addJobLog: jest.fn()
}));

const { runCypressSystemTest } = await import("../services/cypressSystemTestRunner.service.js");
const fs = (await import("fs")).default;
const { dockerRunner } = await import("../services/dockerRunner.service.js");
const jobService = await import("../services/job.service.js");

describe("cypressSystemTestRunner.service", () => {
    const jobId = "test-job-id";
    const rootDir = "/mock/project";

    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(true);
        fs.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => true });
        fs.readFileSync.mockReturnValue(JSON.stringify({ devDependencies: { cypress: "10.0.0" } }));
        dockerRunner.run.mockResolvedValue({});
        jobService.addJobLog.mockResolvedValue();
    });

    it("should run cypress successfully", async () => {
        dockerRunner.run.mockResolvedValue({
            success: true,
            exitCode: 0,
            stdout: "All tests passed",
            stderr: ""
        });

        const result = await runCypressSystemTest(jobId, rootDir);

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(dockerRunner.run).toHaveBeenCalled();
    });

    it("should throw error if cypress is not installed", async () => {
        fs.readFileSync.mockReturnValue(JSON.stringify({}));
        await expect(runCypressSystemTest(jobId, rootDir)).rejects.toThrow("Cypress is not installed");
    });
});