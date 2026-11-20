import { AnimatePresence } from "framer-motion";
import Toast from "./dashboard/Toast.jsx";

/**
 * Manages and displays multiple toast notifications (aligned bottom-right with ToastProvider)
 */
export const ToastContainer = ({ toasts, setToasts }) => {
  const removeToast = (id) => {
    setToasts((prevToasts) => prevToasts.filter((toast) => toast.id !== id));
  };

  return (
    <div className="fixed bottom-12 right-6 z-[9999] flex flex-col-reverse gap-2.5 pointer-events-none max-w-[400px] w-[calc(100vw-2rem)]">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            toast={toast}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
