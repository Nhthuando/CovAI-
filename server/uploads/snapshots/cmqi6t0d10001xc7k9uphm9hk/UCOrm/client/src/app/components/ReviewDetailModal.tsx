import { useEffect, useState } from 'react';
import { X, Star, Check, Loader2 } from 'lucide-react';
import {
  ApiError,
  approveReview,
  generateAIReplies,
  getAIReplies,
  type ApiReply,
} from '../api/client';

type Review = {
  id: string;
  author: string;
  rating: number;
  text: string;
  status: 'pending' | 'resolved';
  date: string;
  place: string;
  approvedReplyId?: string | null;
};

type AIReplyOption = {
  id: string;
  title: string;
  tone: string;
  content: string;
};

interface ReviewDetailModalProps {
  review: Review;
  onClose: () => void;
  onStatusChange: (
    reviewId: string,
    newStatus: 'pending' | 'resolved',
    approvedReplyId?: string | null
  ) => void;
  onAuthError: () => void;
}

const replyMeta: Record<string, { title: string; tone: string }> = {
  STANDARD: { title: 'Chuyên nghiệp', tone: 'Standard' },
  FRIENDLY: { title: 'Thân thiện', tone: 'Friendly' },
  FIX: { title: 'Khắc phục lỗi', tone: 'Fix' },
};

const mapReply = (reply: ApiReply): AIReplyOption => {
  const meta = replyMeta[reply.type] || { title: 'Phản hồi', tone: reply.type };
  return {
    id: reply.id,
    title: meta.title,
    tone: meta.tone,
    content: reply.content,
  };
};

export default function ReviewDetailModal({
  review,
  onClose,
  onStatusChange,
  onAuthError,
}: ReviewDetailModalProps) {
  const [selectedReply, setSelectedReply] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiReplies, setAIReplies] = useState<AIReplyOption[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadReplies = async () => {
      try {
        const replies = await getAIReplies(review.id);
        if (!isMounted) return;
        setAIReplies(replies.map(mapReply));
      } catch (error) {
        if (!isMounted) return;
        if (error instanceof ApiError && error.status === 401) {
          onAuthError();
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          return;
        }
      }
    };

    void loadReplies();
    return () => {
      isMounted = false;
    };
  }, [review.id, onAuthError]);

  useEffect(() => {
    setSelectedReply(review.approvedReplyId ?? null);
  }, [review.approvedReplyId, review.id]);

  const handleGenerateAI = async () => {
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const replies = await generateAIReplies(review.id);
      setAIReplies(replies.map(mapReply));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthError();
        return;
      }
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Không thể tạo phản hồi AI, vui lòng thử lại.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApprove = async (replyId: string) => {
    setSelectedReply(replyId);
    setErrorMessage(null);
    try {
      await approveReview(review.id, replyId);
      onStatusChange(review.id, 'resolved', replyId);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthError();
        return;
      }
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Không thể phê duyệt phản hồi, vui lòng thử lại.');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Chi tiết đánh giá</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Review Content */}
        <div className="p-6 border-b border-gray-200 overflow-y-auto">
          <div className="flex items-start gap-4 mb-4">
            <div className="review-avatar review-avatar--lg bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-white font-bold text-lg uppercase leading-none">
              {review.author?.[0] || '?'}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{review.author}</h3>
                  <p className="text-sm text-gray-500">
                    {review.place} • {review.date}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    review.status === 'pending'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {review.status === 'pending' ? 'Chờ xử lý' : 'Đã xử lý'}
                </span>
              </div>
              <div className="flex gap-0.5 mb-3">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className={`w-5 h-5 ${
                      i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'
                    }`}
                  />
                ))}
              </div>
              <p className="text-gray-700 leading-relaxed">{review.text}</p>
            </div>
          </div>
        </div>

        {/* AI Replies Section */}
        <div className="p-6 flex-1 overflow-y-auto">
          {errorMessage && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
          {aiReplies.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Star className="w-8 h-8 text-blue-700" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Tạo phản hồi bằng AI
              </h3>
              <p className="text-gray-600 mb-6">
                AI sẽ tạo 3 phiên bản phản hồi với giọng điệu khác nhau
              </p>
              <button
                onClick={handleGenerateAI}
                disabled={isGenerating}
                className="px-6 py-3 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors font-medium inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Đang tạo...
                  </>
                ) : (
                  <>
                    <Star className="w-5 h-5" />
                    Tạo phản hồi AI
                  </>
                )}
              </button>
            </div>
          ) : (
            <div>
              <h3 className="font-semibold text-gray-900 mb-4">Chọn phản hồi phù hợp:</h3>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {aiReplies.map((reply) => {
                  const isApproved =
                    review.status === 'resolved' &&
                    Boolean(review.approvedReplyId) &&
                    reply.id === review.approvedReplyId;
                  const isSelected = selectedReply === reply.id;

                  return (
                    <div
                      key={reply.id}
                      className={`border-2 rounded-xl p-4 transition-all cursor-pointer ${
                        isApproved
                          ? 'border-emerald-600 bg-emerald-50'
                          : isSelected
                            ? 'border-blue-700 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300'
                      }`}
                      onClick={() => setSelectedReply(reply.id)}
                    >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900">{reply.title}</h4>
                        <p className="text-xs text-gray-500">{reply.tone}</p>
                      </div>
                      {(isApproved || isSelected) && (
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            isApproved ? 'bg-emerald-600' : 'bg-blue-700'
                          }`}
                        >
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                      {reply.content}
                    </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApprove(reply.id);
                        }}
                        disabled={isApproved}
                        className={`mt-4 w-full px-4 py-2 rounded-lg transition-colors font-medium text-sm ${
                          isApproved
                            ? 'bg-emerald-100 text-emerald-700 cursor-default'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                      >
                        {isApproved ? 'Đã chọn' : 'Chấp nhận'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
