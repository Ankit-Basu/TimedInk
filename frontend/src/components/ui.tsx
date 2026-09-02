import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import type { EmailStatus } from '../lib/types';

/**
 * TimedInk UI vocabulary — true glassmorphic dark-theme components.
 */

// --- buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-500 text-white ' +
    'hover:from-violet-500 hover:via-purple-500 hover:to-fuchsia-400 ' +
    'hover:shadow-[0_0_24px_rgba(139,92,246,0.5)] border border-white/20 ' +
    'focus-visible:outline-violet-400',
  secondary:
    'interactive-glass text-slate-200 ' +
    'hover:text-white hover:border-white/20 ' +
    'focus-visible:outline-violet-400',
  ghost:
    'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
  danger:
    'bg-red-500/10 text-red-300 border border-red-500/25 ' +
    'hover:bg-red-500/20 hover:text-red-200 hover:border-red-500/40 ' +
    'focus-visible:outline-red-400',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold
        transition-all duration-200 ease-out active:scale-[0.98]
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:cursor-not-allowed disabled:opacity-40 select-none ${BUTTON_STYLES[variant]} ${className}`}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

// --- form fields -----------------------------------------------------------

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-fuchsia-400">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-red-400 font-medium">
          {error}
        </span>
      )}
    </label>
  );
}

const CONTROL_CLASS =
  'block w-full rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 ' +
  'interactive-glass focus:ring-0';

export const Input = ({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...rest} className={`${CONTROL_CLASS} ${className}`} />
);

export const Textarea = ({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...rest} className={`${CONTROL_CLASS} ${className}`} />
);

// --- status ----------------------------------------------------------------

const STATUS_STYLES: Record<EmailStatus, string> = {
  PENDING: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  QUEUED: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  SENDING: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  SENT: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  FAILED: 'bg-red-500/15 text-red-300 ring-red-500/30',
  CANCELLED: 'bg-slate-500/10 text-slate-400 ring-slate-500/20',
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {status === 'SENDING' && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
      )}
      {status === 'SENT' && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
      )}
      {status.toLowerCase()}
    </span>
  );
}

/** Bonus A — colour-coded deliverability score with its flags on hover. */
export function DeliverabilityBadge({
  score,
  flags,
}: {
  score: number | null;
  flags: { code: string; message: string }[];
}) {
  if (score === null) return <span className="text-xs text-slate-500">—</span>;

  const band = score >= 80 ? 'good' : score >= 50 ? 'warning' : 'poor';
  const styles = {
    good: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 shadow-[0_0_8px_rgba(52,211,153,0.2)]',
    warning: 'bg-amber-500/15 text-amber-300 ring-amber-500/30 shadow-[0_0_8px_rgba(251,191,36,0.2)]',
    poor: 'bg-red-500/15 text-red-300 ring-red-500/30 shadow-[0_0_8px_rgba(248,113,113,0.2)]',
  }[band];

  return (
    <span className="group relative inline-block">
      <span
        className={`inline-flex cursor-default items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${styles}`}
        aria-describedby={flags.length ? `flags-${score}` : undefined}
      >
        {score}
      </span>
      {flags.length > 0 && (
        <span
          id={`flags-${score}`}
          role="tooltip"
          className="pointer-events-none absolute top-full left-0 z-20 mt-2 hidden w-72 rounded-xl
            elevation-3 p-3 text-left text-xs leading-relaxed text-slate-300 shadow-xl group-hover:block"
        >
          <span className="mb-1 block font-semibold text-white">
            {flags.length} deliverability {flags.length === 1 ? 'flag' : 'flags'}
          </span>
          {flags.map((f) => (
            <span key={f.code} className="block">
              • {f.message}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

// --- feedback states -------------------------------------------------------

export const Spinner = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-90"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
);

export function ShimmerTableRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <div className="skeleton-shimmer h-4 w-32 rounded" />
          <div className="skeleton-shimmer h-4 flex-1 rounded" />
          <div className="skeleton-shimmer h-4 w-24 rounded" />
          <div className="skeleton-shimmer h-4 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-12">
      <ShimmerTableRows rows={5} />
      <div className="flex items-center justify-center gap-2 pt-4 text-xs text-slate-500">
        <Spinner className="h-3.5 w-3.5 text-violet-400" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="relative px-6 py-16 text-center overflow-hidden">
      {/* Subtle sweeping clock hand in background */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
        <div className="w-48 h-48 rounded-full border border-white relative animate-sweep-slow">
          <div className="absolute top-1/2 left-1/2 w-20 h-0.5 bg-white origin-left" />
        </div>
      </div>

      <div className="relative z-10">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl elevation-2 text-violet-400 animate-float">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        </div>
        <p className="text-base font-semibold text-slate-200" style={{ fontFamily: 'var(--font-heading)' }}>
          {title}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">{description}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="px-6 py-16 text-center" role="alert">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20 text-red-400">
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <p className="text-sm font-semibold text-red-300">Could not load this view</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{message}</p>
      {onRetry && (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/** Inline banner for form-level errors. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300 border border-red-500/25 backdrop-blur-md">
      {children}
    </div>
  );
}
