import type { ButtonHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react';
import type { EmailStatus } from '../lib/types';

/**
 * Shared UI vocabulary.
 *
 * Everything sits on glass: a frosted pane, a hairline edge that catches light
 * along the top, and the violet → pink → cyan gradient reserved for the one
 * thing on screen you are most likely to press.
 */

// --- buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  // Dark text on the light gradient — white would fail contrast on the cyan end.
  primary: 'btn-primary font-semibold',
  secondary:
    'border border-edge bg-glass-2 text-ink hover:bg-glass-3 hover:border-edge-strong backdrop-blur-md',
  ghost: 'border border-transparent bg-transparent text-ink-2 hover:text-ink hover:bg-glass-2',
  danger:
    'border border-st-failed/30 bg-st-failed/10 text-st-failed hover:bg-st-failed/20 hover:border-st-failed/50',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-[13px] gap-2 rounded-xl',
  lg: 'h-12 px-6 text-sm gap-2.5 rounded-2xl',
} as const;

export function Button({
  variant = 'primary',
  size = 'md',
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
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap
        transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45
        ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

// --- form fields -----------------------------------------------------------

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  /** Extra content on the label row, right-aligned (a counter, a toggle). */
  aside?: ReactNode;
}

export function Field({ label, hint, error, required, children, aside }: FieldProps) {
  return (
    <label className="block">
      {/*
        Most fields here are mandatory, so marking every one "required" is noise
        that reads like an error. Mark the exceptions instead.
      */}
      <span className="mb-2 flex items-baseline justify-between gap-2">
        <span className="label flex items-baseline gap-2">
          {label}
          {!required && <span className="tracking-normal normal-case opacity-70">optional</span>}
        </span>
        {aside}
      </span>
      {children}
      {hint && !error && <span className="mt-2 block text-xs leading-relaxed text-ink-3">{hint}</span>}
      {error && (
        <span role="alert" className="mt-2 block text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

const CONTROL =
  'well block w-full rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3/70 ' +
  'transition-[border-color,box-shadow,background-color] duration-200 ' +
  'hover:border-edge-strong focus:border-accent/70 focus:bg-black/30 focus:outline-none ' +
  'focus:shadow-[0_0_0_4px_rgb(255_165_60/0.15)] focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Input = ({ className = '', ...rest }: ComponentPropsWithRef<'input'>) => (
  <input {...rest} className={`${CONTROL} ${className}`} />
);

export const Textarea = ({ className = '', ...rest }: ComponentPropsWithRef<'textarea'>) => (
  <textarea {...rest} className={`${CONTROL} resize-y leading-relaxed ${className}`} />
);

// --- status ----------------------------------------------------------------

/**
 * A glowing dot plus a word, in a pill. The dot carries the state when you are
 * scanning a column; the word keeps it unambiguous for anyone who cannot tell
 * the hues apart.
 */
const STATUS_STYLE: Record<EmailStatus, { dot: string; pill: string }> = {
  PENDING: { dot: 'bg-st-pending', pill: 'text-st-pending bg-st-pending/10 border-st-pending/20' },
  QUEUED: { dot: 'bg-st-queued', pill: 'text-st-queued bg-st-queued/10 border-st-queued/25' },
  SENDING: { dot: 'bg-st-sending', pill: 'text-st-sending bg-st-sending/10 border-st-sending/25' },
  SENT: { dot: 'bg-st-sent', pill: 'text-st-sent bg-st-sent/10 border-st-sent/25' },
  FAILED: { dot: 'bg-st-failed', pill: 'text-st-failed bg-st-failed/10 border-st-failed/25' },
  CANCELLED: {
    dot: 'bg-st-cancelled',
    pill: 'text-st-cancelled bg-st-cancelled/10 border-st-cancelled/20',
  },
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const style = STATUS_STYLE[status];
  const live = status === 'SENDING' || status === 'QUEUED';
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium tracking-wider ${style.pill}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor] ${style.dot} ${
          live ? 'pulse-ring' : ''
        }`}
        aria-hidden="true"
      />
      {status}
    </span>
  );
}

/**
 * Bonus A — deliverability score: a figure over a thin bar that fills to
 * match. The flags sit in the `title`, one hover away without a tooltip lib.
 */
export function DeliverabilityBadge({
  score,
  flags,
}: {
  score: number | null;
  flags: { code: string; message: string }[];
}) {
  if (score === null) return <span className="text-ink-3">—</span>;

  const tone = score >= 80 ? 'text-st-sent' : score >= 50 ? 'text-st-sending' : 'text-st-failed';
  const bar =
    score >= 80
      ? 'from-emerald-400 to-plum'
      : score >= 50
        ? 'from-amber-300 to-orange-400'
        : 'from-rose-400 to-ember';

  const title =
    flags.length === 0
      ? 'No deliverability issues found'
      : `${flags.length} issue${flags.length === 1 ? '' : 's'}:\n${flags
          .map((f) => `• ${f.message}`)
          .join('\n')}`;

  return (
    <span className="inline-flex cursor-default flex-col gap-1.5" title={title}>
      <span className={`mono text-[13px] leading-none font-medium ${tone}`}>{score}</span>
      <span className="block h-1 w-12 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <span
          className={`block h-full rounded-full bg-gradient-to-r ${bar}`}
          style={{ width: `${score}%` }}
        />
      </span>
    </span>
  );
}

// --- feedback states -------------------------------------------------------

export const Spinner = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
  </svg>
);

/**
 * Skeleton rows rather than a centred spinner: the table keeps its shape, so
 * the page does not jump when data lands.
 */
export function LoadingState({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-edge" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-6 py-5">
          <div className="skeleton h-3 w-44" />
          <div className="skeleton h-3 flex-1" />
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-5 w-20 rounded-full" />
        </div>
      ))}
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
    <div className="px-6 py-20">
      <div className="mx-auto max-w-md text-center">
        <div className="glass float-slow mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl">
          <svg className="h-7 w-7 text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 7.5 12 13l9-5.5M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="headline text-3xl text-ink">{title}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{description}</p>
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="px-6 py-20" role="alert">
      <div className="mx-auto max-w-md text-center">
        <p className="headline text-3xl text-danger">Could not load this view</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{message}</p>
        {onRetry && (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
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
    <div
      role="alert"
      className="rounded-xl border border-st-failed/30 bg-st-failed/10 px-3.5 py-2.5 text-[13px] text-st-failed"
    >
      {children}
    </div>
  );
}

/** A glass container — the single panel primitive the app uses. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-3xl ${className}`}>{children}</div>;
}

/** Round avatar: the Google picture when there is one, initials otherwise. */
export function Avatar({ name, src, size = 34 }: { name: string; src?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

  return (
    <span
      className="ring-gradient relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-amber/60 to-plum/40 text-xs font-semibold text-white"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          width={size}
          height={size}
        />
      ) : (
        initials || '?'
      )}
    </span>
  );
}

export const CloseIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
  </svg>
);
