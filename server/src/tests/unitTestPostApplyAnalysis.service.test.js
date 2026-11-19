import { expect, jest, test } from "@jest/globals";

const createRunTestsJob = jest.fn().mockResolvedValueOnce({ id: "job-1", status: "QUEUED" })
    .mockResolvedValueOnce({ id: "job-1", status: "COMPLETED" });
const addJobToQueue = jest.fn();
await jest.unstable_mockModule("../services/job.service.js", () => ({ createRunTestsJob }));
await jest.unstable_mockModule("../services/queue.service.js", () => ({ addJobToQueue }));
const { scheduleUnitTestPostApplyAnalysis } = await import("../services/unitTestPostApplyAnalysis.service.js");

test("queues analysis after a successful publication and reuses the same job on a completed retry", async () => {
    const operation = { projectId: "project", snapshotId: "snapshot", userId: "editor" };
    await expect(scheduleUnitTestPostApplyAnalysis({
        ...operation, result: { success: false, status: "FAILED", fileUpdated: false },
    })).resolves.toBeNull();
    expect(createRunTestsJob).not.toHaveBeenCalled();

    const published = { ...operation, result: { success: true, status: "PASSED", fileUpdated: true, runId: "run-1" } };
    await scheduleUnitTestPostApplyAnalysis(published);
    await scheduleUnitTestPostApplyAnalysis(published);

    expect(createRunTestsJob.mock.calls[0][0].requestId).toMatch(/^unit-apply-analysis-/);
    expect(createRunTestsJob.mock.calls[1][0].requestId).toBe(createRunTestsJob.mock.calls[0][0].requestId);
    expect(addJobToQueue).toHaveBeenCalledTimes(1);
    expect(addJobToQueue).toHaveBeenCalledWith("RUN_TESTS", "job-1");
});

test("refreshes coverage for an already fully covered baseline without publishing tests", async () => {
    createRunTestsJob.mockClear().mockResolvedValue({ id: "refresh", status: "QUEUED" });
    addJobToQueue.mockClear();
    const operation = { projectId: "project", snapshotId: "snapshot", userId: "editor" };
    const result = { success: true, status: "NO_CHANGES", fileUpdated: false, runId: "run-unchanged" };
    await expect(scheduleUnitTestPostApplyAnalysis({ ...operation, result })).resolves.toBeNull();
    const verified = { ...result, workflowState: "BASELINE_ALREADY_FULLY_COVERED" };
    await expect(scheduleUnitTestPostApplyAnalysis({ ...operation, result: verified })).resolves.toEqual({
        id: "refresh", type: "RUN_TESTS", status: "QUEUED",
    });
    expect(createRunTestsJob).toHaveBeenCalledTimes(1);
    expect(createRunTestsJob).toHaveBeenCalledWith(expect.objectContaining({ testType: "unit", verifyPublishedUnitTests: true }));
    expect(addJobToQueue).toHaveBeenCalledWith("RUN_TESTS", "refresh");
});
