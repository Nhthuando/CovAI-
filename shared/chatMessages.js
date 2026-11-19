const VI_DIACRITIC_RE = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;
const VI_PHRASE_RE = /(?:^|\s)(?:xin chao|chao ban|cam on|tai sao|the nao|khong co|giup toi|giup minh|sua loi|giai thich|kiem tra|du an)(?=\s|[?!.,]|$)/i;

export function detectChatLanguage(text = '') {
  const s = String(text || '').trim();
  if (!s) return 'en';
  if (VI_DIACRITIC_RE.test(s) || VI_PHRASE_RE.test(s)) return 'vi';
  return 'en';
}

export function chatErrorMessage(error = {}, userMessage = '') {
  const isVi = detectChatLanguage(userMessage) === 'vi';
  if (isVi) {
    const viMessages = {
      AI_REQUEST_TIMEOUT: 'Trợ lý dự án phản hồi quá lâu. Vui lòng thử lại.',
      CHAT_CONNECTION_ERROR: 'Không thể kết nối tới trợ lý dự án. Vui lòng thử lại sau giây lát.',
      AI_PROVIDER_UNAVAILABLE: 'Trợ lý AI đang tạm thời gián đoạn. Vui lòng thử lại sau giây lát.',
      AI_MODEL_UNAVAILABLE: 'Mô hình AI tạm thời không khả dụng. Vui lòng thử lại hoặc liên hệ quản trị viên.',
      AI_AUTH_ERROR: 'Trợ lý dự án chưa sẵn sàng (lỗi xác thực). Vui lòng liên hệ quản trị viên.',
      AI_KEY_NOT_CONFIGURED: 'Trợ lý dự án chưa được cấu hình API key. Vui lòng liên hệ quản trị viên.',
      AI_QUOTA_EXCEEDED: 'Trợ lý AI đã đạt giới hạn sử dụng. Vui lòng thử lại sau.',
      AI_APP_QUOTA_EXCEEDED: 'Bạn đã dùng hết hạn mức AI trong ngày trên CovAI. Vui lòng thử lại vào ngày mai.',
      CHAT_CONTEXT_CHANGED: 'Dự án vừa thay đổi. Hãy tải lại dữ liệu hiện tại và gửi lại câu hỏi.',
      CHAT_BUSY: 'Câu hỏi trước đang được xử lý. Vui lòng chờ một chút rồi thử lại.',
      CHAT_REQUEST_FAILED: 'Yêu cầu trước chưa thể hoàn tất. Hãy bấm thử lại.',
    };
    return viMessages[error.code] || 'Trợ lý dự án tạm thời không thể phản hồi. Vui lòng thử lại.';
  }

  const messages = {
    AI_REQUEST_TIMEOUT: 'The project assistant took too long to respond. Please try again.',
    CHAT_CONNECTION_ERROR: 'Unable to reach the project assistant. Please try again in a moment.',
    AI_PROVIDER_UNAVAILABLE: 'The project assistant is temporarily unavailable. Please try again in a moment.',
    AI_MODEL_UNAVAILABLE: 'The project assistant is temporarily unavailable. Please contact your project administrator if this continues.',
    AI_AUTH_ERROR: 'The project assistant is not available. Please contact your project administrator.',
    AI_KEY_NOT_CONFIGURED: 'The project assistant has not been configured yet. Please contact your project administrator.',
    AI_QUOTA_EXCEEDED: 'The project assistant has reached its usage limit. Please try again later.',
    AI_APP_QUOTA_EXCEEDED: 'You have reached your daily AI usage limit in CovAI. Please try again tomorrow.',
    CHAT_CONTEXT_CHANGED: 'Your project has changed. Refresh the current file and send your question again.',
    CHAT_BUSY: 'Your previous question is still being processed. Please wait a moment before trying again.',
    CHAT_REQUEST_FAILED: 'The previous request could not be completed. Use Retry to send it again.',
  };
  return messages[error.code] || 'The project assistant could not respond. Please try again.';
}
