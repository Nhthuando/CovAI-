import { AsyncLocalStorage } from 'node:async_hooks';
import { ServiceError } from '../utils/serviceError.js';

const storage = new AsyncLocalStorage();
export const createAiJobBudget = ({ maxRequests = 6, signal, assertActive = async () => {}, onChange = async () => {} } = {}) => {
    const usage = { maxRequests, requests: 0, reportedRequests: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    const snapshot = () => ({ ...usage, incomplete: usage.reportedRequests < usage.requests });
    return {
        signal,
        snapshot,
        async beforeRequest() {
            await assertActive();
            if (signal?.aborted) throw new ServiceError('AI improvement canceled', 409);
            if (usage.requests >= maxRequests) {
                const error = new ServiceError('AI request budget reached. No further AI requests were sent.', 422);
                error.code = 'AI_JOB_BUDGET_EXCEEDED';
                throw error;
            }
            usage.requests++;
            await onChange(snapshot());
        },
        async record(metadata) {
            if (Number.isFinite(metadata?.totalTokenCount)) {
                usage.reportedRequests++;
                usage.promptTokens += metadata.promptTokenCount || 0;
                usage.outputTokens += metadata.candidatesTokenCount || 0;
                // Provider totals may include thinking tokens; do not reconstruct them.
                usage.totalTokens += metadata.totalTokenCount;
            }
            await onChange(snapshot());
        },
    };
};
export const withAiJobBudget = (budget, callback) => storage.run(budget, callback);
export const currentAiJobBudget = () => storage.getStore();
