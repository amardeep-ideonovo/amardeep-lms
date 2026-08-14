"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Transient feedback for work that finishes away from the control that started
// it. The admin already has two channels — inline <p className="error"> next to
// a form, and dialog.notify() for things that must be acknowledged. Neither
// fits a failure on a long, scrolled page: the inline error renders at the top
// of the page, often far off screen, and a modal is too heavy for "that didn't
// save".
//
// The live region is mounted at all times rather than created with the first
// message: screen readers only announce changes to a region that already
// existed, so one that appears together with its content stays silent.

type ToastTone = "error" | "success";

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onAction: () => void };
};

type ShowToast = (
  message: string,
  opts?: { tone?: ToastTone; action?: Toast["action"]; durationMs?: number },
) => void;

const ToastContext = createContext<ShowToast | null>(null);

const DEFAULT_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, opts) => {
      const id = nextId.current++;
      const tone = opts?.tone ?? "error";
      setToasts((prev) => [
        ...prev,
        { id, tone, message, action: opts?.action },
      ]);
      // An error offering a retry stays until it's acted on — auto-hiding it
      // would take the recovery away with it.
      const sticky = tone === "error" && !!opts?.action;
      if (!sticky) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), opts?.durationMs ?? DEFAULT_MS),
        );
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action?.onAction();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Returns a no-op outside the provider, so a component can call it without
// knowing whether it renders inside the admin shell.
export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  return useMemo(() => ctx ?? (() => {}), [ctx]);
}
