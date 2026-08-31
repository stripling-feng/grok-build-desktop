import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Keep app-owned dialogs out of clipped/blurred layout surfaces such as the
 * sidebar. SSR/static-markup callers still receive the children in place.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined" || !document.body) return <>{children}</>;
  return createPortal(children, document.body);
}

type ConfirmDialogProps = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  danger?: boolean;
};

/**
 * Small app-owned confirmation surface for destructive or consequential
 * actions. Keeping this next to ModalPortal ensures confirmations never fall
 * back to a browser/Electron-native prompt that can be clipped by the shell.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onClose,
  onConfirm,
  danger = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = cancelRef.current?.closest<HTMLElement>("[role=dialog]");
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex=\"-1\"])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <ModalPortal>
      <div
        className="modal-backdrop nested confirm-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="btn small ghost" type="button" aria-label="关闭" onClick={onClose}>关闭</button>
          </div>
          <div className="confirm-modal-body">{message}</div>
          <div className="confirm-modal-actions">
            <button ref={cancelRef} className="btn ghost" type="button" onClick={onClose}>取消</button>
            <button className={`btn ${danger ? "danger" : "primary"}`} type="button" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

export function AlertDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: ReactNode;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title={title}
      message={message}
      confirmLabel="知道了"
      onClose={onClose}
      onConfirm={onClose}
    />
  );
}
