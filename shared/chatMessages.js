export function chatErrorMessage(error = {}) {
  const messages = {
    AI_REQUEST_TIMEOUT: 'The project assistant took too long to respond. Please try again. Your draft is still here.',
    CHAT_CONNECTION_ERROR: 'Unable to reach the project assistant. Please try again in a moment. Your draft is still here.',
    AI_PROVIDER_UNAVAILABLE: 'The project assistant is temporarily unavailable. Please try again in a moment. Your draft is still here.',
    AI_MODEL_UNAVAILABLE: 'The project assistant is temporarily unavailable. Please contact your project administrator if this continues.',
    AI_AUTH_ERROR: 'The project assistant is not available. Please contact your project administrator.',
    AI_KEY_NOT_CONFIGURED: 'The project assistant has not been configured yet. Please contact your project administrator.',
    AI_QUOTA_EXCEEDED: 'The project assistant has reached its usage limit. Please try again later. Your draft is still here.',
    CHAT_CONTEXT_CHANGED: 'Your project has changed. Refresh the current file and send your question again.',
    CHAT_BUSY: 'Your previous question is still being processed. Please wait a moment before trying again.',
    CHAT_REQUEST_FAILED: 'The previous request could not be completed. Your draft is still here; please send it again.',
  };
  return messages[error.code] || 'The project assistant could not respond. Please try again. Your draft is still here.';
}
