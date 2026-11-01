import { createContext, useContext, useState, useCallback, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import Toast from "./Toast.jsx";

const ToastContext = createContext(null);

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const parentCtx = useContext(ToastContext);
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type = "info", title, message, duration = 4500 }) => {
      const id = ++toastIdCounter;
      const toast = { id, type, title, message };

      setToasts((prev) => {
        // Keep max 5 toasts
        const next = [...prev, toast];
        if (next.length > 5) next.shift();
        return next;
      });

      if (duration > 0) {
        timersRef.current[id] = setTimeout(() => removeToast(id), duration);
      }

      return id;
    },
    [removeToast]
  );

  // If already inside a global ToastProvider, pass children through without mounting a duplicate fixed container
  if (parentCtx) {
    return children;
  }

  return (
    <ToastContext.Provider value={{ showToast, addToast: showToast, removeToast }}>
      {children}

      {/* Toast Container — fixed bottom-right */}
      <div
        style={{
          position: "fixed",
          bottom: 48,
          right: 32,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column-reverse",
          gap: 10,
          pointerEvents: "none",
          maxWidth: 420,
          width: "100%",
        }}
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              toast={toast}
              onClose={() => {
                removeToast(toast.id);
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

const FALLBACK_TOAST_CTX = {
  showToast: () => null,
  addToast: () => null,
  removeToast: () => {},
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    console.warn("[ToastContext] useToast called outside ToastProvider; using no-op fallback.");
    return FALLBACK_TOAST_CTX;
  }
  return ctx;
}

