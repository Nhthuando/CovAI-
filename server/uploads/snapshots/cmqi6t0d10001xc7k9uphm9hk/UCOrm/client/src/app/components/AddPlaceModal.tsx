import { useState } from 'react';
import { X, MapPin, Loader2, CheckCircle } from 'lucide-react';
import { ApiError, addPlace } from '../api/client';

interface AddPlaceModalProps {
  onClose: () => void;
  onPlaceAdded: () => void;
  onAuthError: () => void;
}

export default function AddPlaceModal({ onClose, onPlaceAdded, onAuthError }: AddPlaceModalProps) {
  const [placeId, setPlaceId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    setErrorMessage(null);

    try {
      await addPlace(placeId.trim());
      setSuccess(true);
      await onPlaceAdded();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthError();
        return;
      }

      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Không thể thêm địa điểm, vui lòng thử lại.');
      }
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-2 rounded-lg">
                <MapPin className="w-6 h-6 text-blue-700" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Thêm địa điểm mới</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6">
          {!success ? (
            <>
              {errorMessage && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {errorMessage}
                </div>
              )}
              <div className="mb-6">
                <label htmlFor="place-id" className="block text-sm font-medium text-gray-700 mb-2">
                  Google Place ID
                </label>
                <input
                  id="place-id"
                  type="text"
                  value={placeId}
                  onChange={(e) => setPlaceId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
                  placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                  required
                />
                <p className="mt-2 text-xs text-gray-500">
                  Nhập Place ID từ Google Maps để tự động lấy đánh giá
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h4 className="font-medium text-blue-900 mb-2 text-sm">
                  Làm thế nào để tìm Place ID?
                </h4>
                <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
                  <li>Nhấn để truy cập vào trang web sau: <a 
      href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block bg-blue-600 text-white font-bold px-2 py-0.5 rounded shadow-sm shadow-blue-500/50 hover:bg-blue-700 transition-colors no-underline"
    >
      Place ID
    </a> </li>
                  <li>Click vào địa điểm để xem thông tin</li>
                  <li>Lấy Place ID</li>
                </ol>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isAdding || !placeId}
                  className="flex-1 px-4 py-2.5 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Đang thêm...
                    </>
                  ) : (
                    'Thêm địa điểm'
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Thành công!</h3>
              <p className="text-gray-600">
                Địa điểm đã được thêm vào hệ thống. Đánh giá sẽ được đồng bộ tự động.
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
