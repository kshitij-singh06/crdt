/**
 * ConfirmModal.tsx
 *
 * A styled replacement for window.confirm(). Renders as a portal overlay
 * matching the app's dark theme. Purely visual — same confirm/cancel flow.
 */

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onCancel();
    },
    [onCancel]
  );

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="confirm-modal">
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button
            className="btn-ghost confirm-cancel-btn"
            onClick={onCancel}
            id="confirm-cancel-btn"
          >
            {cancelLabel}
          </button>
          <button
            className={`btn-primary confirm-action-btn ${variant === "danger" ? "confirm-action-btn--danger" : ""}`}
            onClick={onConfirm}
            autoFocus
            id="confirm-action-btn"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
