import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { gsap, prefersReducedMotion } from './motion';
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
 * Minimal toast stack. Hand-rolled on the same GSAP ticker as the rest of the
 * app: each card springs in from the right and blurs out on dismiss.
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
        className="pointer-events-none fixed top-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2.5"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ACCENT: Record<ToastType, string> = {
  success: 'bg-st-sent text-st-sent',
  error: 'bg-st-failed text-st-failed',
  info: 'bg-accent text-accent',
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Animate out, then remove — so a dismissed toast leaves rather than vanishes.
  const dismiss = useCallback(() => {
    if (!ref.current || prefersReducedMotion()) {
      onDismiss();
      return;
    }
    gsap.to(ref.current, {
      x: 40,
      opacity: 0,
      filter: 'blur(6px)',
      duration: 0.3,
      ease: 'power2.in',
      onComplete: onDismiss,
    });
  }, [onDismiss]);

  useEffect(() => {
    if (ref.current && !prefersReducedMotion()) {
      gsap.fromTo(
        ref.current,
        { x: 60, opacity: 0, scale: 0.96 },
        { x: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' },
      );
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(dismiss, toast.durationMs);
    return () => clearTimeout(handle);
  }, [toast.durationMs, dismiss]);

  return (
    <div ref={ref} className="glass-strong pointer-events-auto flex gap-3 rounded-2xl p-4">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full shadow-[0_0_10px_currentColor] ${ACCENT[toast.type]}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{toast.title}</p>
        {toast.message && (
          <p className="mt-1 text-xs leading-relaxed break-words text-ink-3">{toast.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 cursor-pointer self-start rounded-lg p-1 text-ink-3 transition-colors hover:bg-white/10 hover:text-ink"
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
