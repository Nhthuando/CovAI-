import { GEMINI_MODEL_IDS, normalizeModelId } from '../../../shared/aiModels.js';
import { ServiceError } from './serviceError.js';
export const validateSelectedAiModel = model => {
    if (!model) return undefined;
    const normalized = normalizeModelId(model);
    if (!GEMINI_MODEL_IDS.includes(normalized)) throw new ServiceError('Select a supported Gemini model.',400);
    return normalized;
};
export const requestedAiModel = req => validateSelectedAiModel(req.get?.('X-Covai-AI-Model') || req.headers?.['x-covai-ai-model'] || req.body?.model);
