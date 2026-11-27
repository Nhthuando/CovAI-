import { test, expect, jest } from '@jest/globals';
import { removeKnowledgeSource } from '../services/aiEvaluation/management.service.js';

test('removing a document archives every version of it', async () => {
    const db = { aiEvaluationKnowledgeSource: {
        findFirst: jest.fn().mockResolvedValue({ id: 's1', sourceKey: 'docs/api/api-contract.md', status: 'READY' }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    } };
    await expect(removeKnowledgeSource(db, 'p1', 's1')).resolves.toEqual({ removed: 2 });
    expect(db.aiEvaluationKnowledgeSource.updateMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', sourceKey: 'docs/api/api-contract.md', status: { not: 'PROCESSING' } },
        data: { status: 'ARCHIVED' },
    });
});

test('a document still processing cannot be removed', async () => {
    const db = { aiEvaluationKnowledgeSource: { findFirst: jest.fn().mockResolvedValue({ id: 's1', sourceKey: 'a', status: 'PROCESSING' }), updateMany: jest.fn() } };
    await expect(removeKnowledgeSource(db, 'p1', 's1')).rejects.toMatchObject({ code: 'SOURCE_PROCESSING' });
    expect(db.aiEvaluationKnowledgeSource.updateMany).not.toHaveBeenCalled();
});
