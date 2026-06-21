import { jest } from '@jest/globals';
import { aiSuggestionService } from '../aiSuggestion.service.js';
import { setPrismaClient } from '../../config/prisma.js';

describe('aiSuggestionService', () => {
  let mockPrisma;

  beforeAll(() => {
    // Tạo một bản mock cho PrismaClient
    mockPrisma = {
      aiSuggestion: {
        create: jest.fn(),
      },
    };
    // Inject bản mock vào file config
    setPrismaClient(mockPrisma);
  });

  it('should throw error if validation fails', async () => {
    const invalidData = { projectId: 'invalid-id' };
    await expect(aiSuggestionService.createSuggestion(invalidData))
      .rejects.toThrow('Validation failed');
  });
});