import { AI_MODELS } from '../shared/aiModels.js';
export const getSelectedAIModel = () => {
  const stored=localStorage.getItem('covai.aiModel');
  return AI_MODELS.some(model=>model.id===stored) ? stored : AI_MODELS[0].id;
};
export const setSelectedAIModel = model => {
  if(AI_MODELS.some(item=>item.id===model)) localStorage.setItem('covai.aiModel',model);
};
export const getExplicitAIModel = () => {
  try {
    const stored=localStorage.getItem('covai.aiModel');
    return AI_MODELS.some(model=>model.id===stored) ? stored : null;
  } catch (error) {
    console.warn('Unable to read the selected AI model from localStorage.', error);
    return null;
  }
};
export const getAIModelHeaders = () => {
  const model=getExplicitAIModel();
  return model === null ? {} : {'X-Covai-AI-Model':model};
};
export const quotaMessage = error => {
  const format=date=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'medium'}).format(new Date(date));
  return `${error.model || 'The selected Gemini model'} has reached its quota. ${error.resetAt ? `Daily quota resets at ${format(error.resetAt)} (UTC+7).` : error.retryAt ? `The provider says to retry after ${format(error.retryAt)} (UTC+7). This is a retry time, not a full quota reset.` : 'The provider has not supplied a reset time. Check Google AI Studio for quota details.'}`;
};
