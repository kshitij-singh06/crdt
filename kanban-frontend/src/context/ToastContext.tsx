/**
 * ToastContext.tsx
 *
 * Lightweight toast notification system. Provides a context + hook for
 * showing auto-dismissing success/error/info toasts positioned at the
 * bottom-right of the viewport.
 *
 * Purely visual — replaces inline success/error messages with animated
 * toast popups. No functionality changes.
 */

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  exiting?: boolean;
}

interface ToastContextValue {
  addToast: (type: Toast["type"], message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION = 4000;
const EXIT_DURATION = 300;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    // Mark as exiting first for animation
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    // Actually remove after exit animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_DURATION);
  }, []);

  const addToast = useCallback(
    (type: Toast["type"], message: string) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => removeToast(id), TOAST_DURATION);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div className="toast-container" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onDismiss={() => removeToast(toast.id)}
            />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  // Progress bar
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (toast.exiting) return;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / TOAST_DURATION) * 100);
      setProgress(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [toast.exiting]);

  const icon =
    toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ";

  return (
    <div
      className={`toast toast--${toast.type}${toast.exiting ? " toast--exit" : ""}`}
      role="alert"
    >
      <span className={`toast-icon toast-icon--${toast.type}`}>{icon}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
      <div className="toast-progress">
        <div
          className={`toast-progress-bar toast-progress-bar--${toast.type}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
