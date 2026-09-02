import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  durationMs: number;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string, durationMs?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
const DEFAULT_DURATION_MS = 4000;

/**
 * Minimal toast stack. Deliberately hand-rolled with a CSS keyframe rather
 * than an animation library — three lines of transient text do not justify a
 * runtime dependency.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, title: string, message?: string, durationMs = DEFAULT_DURATION_MS) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, type, title, message, durationMs }].slice(-MAX_VISIBLE));
    },
    [],
  );

  const value = useMemo(() => ({ showToast, removeToast }), [showToast, removeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // aria-live so a screen reader announces the outcome of an action that
        // otherwise only changes a row somewhere else on the page.
        aria-live="polite"
        className="pointer-events-none fixed top-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ACCENT: Record<ToastType, string> = {
  success: 'bg-st-sent',
  error: 'bg-st-failed',
  info: 'bg-accent',
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const handle = setTimeout(onDismiss, toast.durationMs);
    return () => clearTimeout(handle);
  }, [toast.durationMs, onDismiss]);

  return (
    <div className="toast-enter pointer-events-auto flex gap-3 rounded-md border border-line bg-surface-2 p-3">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT[toast.type]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{toast.title}</p>
        {toast.message && (
          <p className="mt-0.5 text-xs leading-relaxed break-words text-fg-muted">{toast.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 self-start rounded p-0.5 text-fg-muted transition-colors hover:text-fg"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
