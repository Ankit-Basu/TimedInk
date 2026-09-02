import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import type { EmailStatus } from '../lib/types';
import StarBorder from './StarBorder';

/**
 * TimedInk UI vocabulary v2 — dark-theme components.
 *
 * v2 changes:
 * - Primary buttons: solid violet + StarBorder sweep (no gradient)
 * - Status colors shifted off Tailwind defaults
 * - Empty state: left-aligned with asymmetric whitespace
 * - Removed "icon in rounded-square badge" pattern from EmptyState/ErrorState
 */

// --- buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

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
  const isDisabled = disabled || loading;

  if (variant === 'primary') {
    return (
      <StarBorder
        as="button"
        color="#8B5CF6"
        speed="5s"
        thickness={1}
        className={`select-none ${isDisabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
        disabled={isDisabled}
        {...rest}
      >
        {loading && <Spinner className="h-4 w-4" />}
        {children}
      </StarBorder>
    );
  }

  const variantStyles: Record<Exclude<ButtonVariant, 'primary'>, string> = {
    secondary:
      'interactive-glass text-slate-200 hover:text-white hover:border-white/20 focus-visible:outline-violet-400',
    ghost:
      'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
    danger:
      'bg-[#e86060]/10 text-[#e86060] border border-[#e86060]/25 ' +
      'hover:bg-[#e86060]/20 hover:text-[#f08080] hover:border-[#e86060]/40 ' +
      'focus-visible:outline-[#e86060]',
  };

  return (
    <button
      {...rest}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold
        transition-all duration-200 ease-out active:scale-[0.98]
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:cursor-not-allowed disabled:opacity-40 select-none ${variantStyles[variant]} ${className}`}
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
        {required && <span className="ml-0.5 text-violet-400">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-[#e86060] font-medium">
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

// --- status (custom colors, shifted off Tailwind defaults) -----------------

const STATUS_STYLES: Record<EmailStatus, string> = {
  PENDING:  'bg-[var(--status-pending-bg)]  text-[var(--status-pending)]  ring-[var(--status-pending-ring)]',
  QUEUED:   'bg-[var(--status-queued-bg)]   text-[var(--status-queued)]   ring-[var(--status-queued-ring)]',
  SENDING:  'bg-[var(--status-sending-bg)]  text-[var(--status-sending)]  ring-[var(--status-sending-ring)]',
  SENT:     'bg-[var(--status-sent-bg)]     text-[var(--status-sent)]     ring-[var(--status-sent-ring)]',
  FAILED:   'bg-[var(--status-failed-bg)]   text-[var(--status-failed)]   ring-[var(--status-failed-ring)]',
  CANCELLED:'bg-[var(--status-cancelled-bg)] text-[var(--status-cancelled)] ring-[var(--status-cancelled-ring)]',
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {status === 'SENDING' && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--status-sending)]" />
      )}
      {status === 'SENT' && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--status-sent)]" />
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
    good: 'bg-[var(--status-sent-bg)] text-[var(--status-sent)] ring-[var(--status-sent-ring)]',
    warning: 'bg-[var(--status-sending-bg)] text-[var(--status-sending)] ring-[var(--status-sending-ring)]',
    poor: 'bg-[var(--status-failed-bg)] text-[var(--status-failed)] ring-[var(--status-failed-ring)]',
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

/**
 * EmptyState v2 — left-aligned with asymmetric whitespace.
 * Removed the "icon in rounded-square badge" pattern.
 */
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
    <div className="px-8 py-14 sm:px-12">
      <div className="max-w-xs">
        <p className="text-sm font-semibold text-slate-200" style={{ fontFamily: 'var(--font-heading)' }}>
          {title}
        </p>
        <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="px-8 py-14 sm:px-12" role="alert">
      <div className="max-w-xs">
        <p className="text-sm font-semibold text-[var(--status-failed)]">Could not load this view</p>
        <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{message}</p>
        {onRetry && (
          <div className="mt-5">
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline banner for form-level errors. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl bg-[var(--status-failed-bg)] px-4 py-3 text-sm text-[var(--status-failed)] border border-[var(--status-failed-ring)] backdrop-blur-md">
      {children}
    </div>
  );
}
