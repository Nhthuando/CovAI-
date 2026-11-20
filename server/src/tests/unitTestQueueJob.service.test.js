import { jest } from '@jest/globals';

const mockJobFindUnique = jest.fn();
const mockMarkJobRunning = jest.fn();
const mockMarkJobSuccess = jest.fn();
const mockMarkJobFailed = jest.fn();
const mockUpdateJobProgress = jest.fn();
const mockAddJobLog = jest.fn();
const mockSuggestUnitTestcases = jest.fn();
const mockApplyUnitTestSuggestion = jest.fn();
const mockSchedulePostApply = jest.fn();

jest.unstable_mockModule('../config/prisma.js', () => ({
  default: {
    job: { findUnique: mockJobFindUnique },
  },
}));

jest.unstable_mockModule('../services/job.service.js', () => ({
  markJobRunning: mockMarkJobRunning,
  markJobSuccess: mockMarkJobSuccess,
  markJobFailed: mockMarkJobFailed,
  updateJobProgress: mockUpdateJobProgress,
  addJobLog: mockAddJobLog,
}));

jest.unstable_mockModule('../services/jobCancellation.service.js', () => ({
  isJobCanceled: jest.fn(() => false),
}));

jest.unstable_mockModule('../services/unitTestSuggestion.service.js', () => ({
  suggestUnitTestcases: mockSuggestUnitTestcases,
}));

jest.unstable_mockModule('../services/applyTestSuggestion.service.js', () => ({
  applyUnitTestSuggestion: mockApplyUnitTestSuggestion,
}));

jest.unstable_mockModule('../services/unitTestPostApplyAnalysis.service.js', () => ({
  scheduleUnitTestPostApplyAnalysis: mockSchedulePostApply,
}));

const { processUnitTestSuggestJob, processUnitTestApplyJob } = await import(
  '../services/unitTestQueueJob.service.js'
);

describe('unitTestQueueJob.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('processUnitTestSuggestJob executes suggestUnitTestcases and persists resultJson via markJobSuccess', async () => {
    mockJobFindUnique.mockResolvedValue({
      id: 'job-suggest-1',
      projectId: 'proj-1',
      snapshotId: 'snap-1',
      userId: 'user-1',
      status: 'QUEUED',
      payloadJson: JSON.stringify({
        filePath: 'all',
        filePaths: ['src/a.js', 'src/b.js'],
        validationMode: 'fast',
        framework: 'jest',
      }),
    });
    const fakeResult = { suggestions: [{ id: 's1', sourceFile: 'src/a.js' }], failedFiles: [] };
    mockSuggestUnitTestcases.mockResolvedValue(fakeResult);

    const out = await processUnitTestSuggestJob('job-suggest-1');

    expect(mockMarkJobRunning).toHaveBeenCalledWith('job-suggest-1');
    expect(mockSuggestUnitTestcases).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        snapshotId: 'snap-1',
        filePath: 'all',
        filePaths: ['src/a.js', 'src/b.js'],
      })
    );
    expect(mockMarkJobSuccess).toHaveBeenCalledWith('job-suggest-1', fakeResult);
    expect(out).toEqual(fakeResult);
  });

  test('processUnitTestApplyJob executes applyUnitTestSuggestion, schedules post-apply, and saves resultJson', async () => {
    mockJobFindUnique.mockResolvedValue({
      id: 'job-apply-1',
      projectId: 'proj-1',
      snapshotId: 'snap-1',
      userId: 'user-1',
      status: 'QUEUED',
      payloadJson: JSON.stringify({
        suggestions: [{ id: 's1', sourceFile: 'src/a.js' }],
        requestId: 'req-12345678',
      }),
    });
    const fakeApplyResult = { appliedCount: 1, fileUpdated: true };
    const fakeBgJob = { id: 'run-job-1', status: 'QUEUED' };
    mockApplyUnitTestSuggestion.mockResolvedValue(fakeApplyResult);
    mockSchedulePostApply.mockResolvedValue(fakeBgJob);

    const out = await processUnitTestApplyJob('job-apply-1');

    expect(mockMarkJobRunning).toHaveBeenCalledWith('job-apply-1');
    expect(mockApplyUnitTestSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        snapshotId: 'snap-1',
        requestId: 'req-12345678',
      })
    );
    expect(mockMarkJobSuccess).toHaveBeenCalledWith('job-apply-1', {
      ...fakeApplyResult,
      backgroundJob: fakeBgJob,
    });
    expect(out.backgroundJob).toEqual(fakeBgJob);
  });
});
