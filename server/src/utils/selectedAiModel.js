import { GEMINI_MODEL_IDS } from '../../../shared/aiModels.js';
import { ServiceError } from './serviceError.js';
export const validateSelectedAiModel = model => {
    if(model && !GEMINI_MODEL_IDS.includes(model)) throw new ServiceError('Select a supported Gemini model.',400);
    return model || undefined;
};
export const requestedAiModel = req => validateSelectedAiModel(req.get?.('X-Covai-AI-Model') || req.headers?.['x-covai-ai-model'] || req.body?.model);
