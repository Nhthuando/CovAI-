import { jest, describe, it, expect } from '@jest/globals';

// Sử dụng unstable_mockModule cho ESM
jest.unstable_mockModule('../config/prisma.js', () => ({
  default: {
    aiTestResult: {
      upsert: jest.fn(),
    },
    aiTest: {
      findUnique: jest.fn().mockResolvedValue({ id: 'test-123' })
    }
  },
}));

// Import động sau khi mock
const { saveAiTestResult } = await import('../services/aiTest.service.js');
const { default: prisma } = await import('../config/prisma.js');

describe('aiTestService', () => {
  it('should save AI test result successfully', async () => {
    const mockData = {
      aiTestId: 'test-123',
      status: 'PASSED',
      output: 'All tests passed',
      error: null,
      duration: 1.5,
    };

    prisma.aiTestResult.upsert.mockResolvedValue(mockData);

    const result = await saveAiTestResult(mockData);

    expect(prisma.aiTestResult.upsert).toHaveBeenCalled();
    expect(result).toEqual(mockData);
  });
});