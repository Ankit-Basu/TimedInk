import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string, durationMs?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, title: string, message?: string, durationMs = 4000) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev.slice(-3), { id, type, title, message, durationMs }]);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast, removeToast }}>
      {children}
      <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none max-w-sm w-full">
        <AnimatePresence>
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const duration = (toast.durationMs ?? 4000) / 1000;

  const iconColors: Record<ToastType, { icon: string; border: string; glow: string }> = {
    success: {
      icon: 'text-emerald-400',
      border: 'border-emerald-500/30',
      glow: 'shadow-[0_0_24px_rgba(16,185,129,0.2)]',
    },
    error: {
      icon: 'text-red-400',
      border: 'border-red-500/30',
      glow: 'shadow-[0_0_24px_rgba(239,68,68,0.2)]',
    },
    info: {
      icon: 'text-violet-400',
      border: 'border-violet-500/30',
      glow: 'shadow-[0_0_24px_rgba(139,92,246,0.2)]',
    },
  };

  const currentTheme = iconColors[toast.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 450, damping: 30 }}
      className={`pointer-events-auto relative overflow-hidden elevation-4 rounded-xl p-4 ${currentTheme.border} ${currentTheme.glow}`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          {toast.type === 'success' && (
            <svg className={`h-5 w-5 ${currentTheme.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {toast.type === 'error' && (
            <svg className={`h-5 w-5 ${currentTheme.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
          {toast.type === 'info' && (
            <svg className={`h-5 w-5 ${currentTheme.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0 pr-4">
          <p className="text-sm font-semibold text-white">{toast.title}</p>
          {toast.message && <p className="mt-0.5 text-xs text-slate-300 line-clamp-2">{toast.message}</p>}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-400 hover:text-white transition-colors"
          aria-label="Dismiss notification"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Auto-dismiss shrinking progress bar */}
      <motion.div
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration, ease: 'linear' }}
        onAnimationComplete={onDismiss}
        className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-violet-500 to-fuchsia-500"
      />
    </motion.div>
  );
};
