import type { ButtonHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react';
import type { EmailStatus } from '../lib/types';

/**
 * Shared UI vocabulary.
 *
 * Not a component library — just the pieces that would otherwise be
 * copy-pasted across three pages. Everything here is flat: a surface, a 1px
 * border, and a colour. Elevation is communicated by the border and the
 * surface step, not by shadow or blur.
 */

// --- buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'bg-transparent text-fg-secondary border border-transparent hover:bg-surface-2 hover:text-fg',
  danger: 'bg-transparent text-danger border border-line hover:bg-surface-2 hover:border-danger/50',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const sizing = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : 'h-9 px-3.5 text-sm gap-2';

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium
        transition-colors disabled:cursor-not-allowed disabled:opacity-45
        ${sizing} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
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
      {/*
        Most fields on these forms are mandatory, so marking every one of them
        "required" is noise that reads like an error. Mark the exceptions
        instead — the reader only has to scan for the short list.
      */}
      <span className="mb-1.5 block text-[13px] font-medium text-fg-secondary">
        {label}
        {!required && <span className="ml-1.5 font-normal text-fg-muted">optional</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-fg-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1.5 block text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

const CONTROL =
  'block w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-sm text-fg ' +
  'placeholder:text-fg-muted transition-colors hover:border-line-strong ' +
  'focus:border-accent focus:outline-none focus-visible:outline-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// React 19 passes `ref` straight through as a prop, so no forwardRef wrapper.
export const Input = ({ className = '', ...rest }: ComponentPropsWithRef<'input'>) => (
  <input {...rest} className={`${CONTROL} ${className}`} />
);

export const Textarea = ({ className = '', ...rest }: ComponentPropsWithRef<'textarea'>) => (
  <textarea {...rest} className={`${CONTROL} resize-y ${className}`} />
);

// --- status ----------------------------------------------------------------

/**
 * A dot plus a word. A coloured dot carries the state at a glance when you are
 * scanning a column; the word makes it unambiguous and keeps it readable for
 * anyone who cannot separate the hues.
 */
const STATUS_DOT: Record<EmailStatus, string> = {
  PENDING: 'bg-st-pending',
  QUEUED: 'bg-st-queued',
  SENDING: 'bg-st-sending',
  SENT: 'bg-st-sent',
  FAILED: 'bg-st-failed',
  CANCELLED: 'bg-st-cancelled',
};

const STATUS_TEXT: Record<EmailStatus, string> = {
  PENDING: 'text-st-pending',
  QUEUED: 'text-st-queued',
  SENDING: 'text-st-sending',
  SENT: 'text-st-sent',
  FAILED: 'text-st-failed',
  CANCELLED: 'text-st-cancelled',
};

const STATUS_LABEL: Record<EmailStatus, string> = {
  PENDING: 'Pending',
  QUEUED: 'Queued',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${STATUS_TEXT[status]}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]} ${
          status === 'SENDING' ? 'animate-pulse' : ''
        }`}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Bonus A — deliverability score.
 *
 * Rendered as a number out of 100 with a short bar, because a bare score is
 * hard to place. The flags sit in the `title` so the detail is one hover away
 * without a tooltip library.
 */
export function DeliverabilityBadge({
  score,
  flags,
}: {
  score: number | null;
  flags: { code: string; message: string }[];
}) {
  if (score === null) return <span className="text-fg-muted">—</span>;

  const tone =
    score >= 80 ? 'text-st-sent' : score >= 50 ? 'text-st-sending' : 'text-st-failed';
  const bar = score >= 80 ? 'bg-st-sent' : score >= 50 ? 'bg-st-sending' : 'bg-st-failed';

  const title =
    flags.length === 0
      ? 'No deliverability issues found'
      : `${flags.length} issue${flags.length === 1 ? '' : 's'}:\n${flags.map((f) => `• ${f.message}`).join('\n')}`;

  return (
    <span className="inline-flex items-center gap-2 cursor-default" title={title}>
      <span className={`tabular text-[13px] font-medium ${tone}`}>{score}</span>
      <span className="h-1 w-8 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <span className={`block h-full ${bar}`} style={{ width: `${score}%` }} />
      </span>
      {flags.length > 0 && (
        <span className="text-[11px] text-fg-muted tabular">{flags.length}</span>
      )}
    </span>
  );
}

// --- feedback states -------------------------------------------------------

export const Spinner = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
  </svg>
);

/**
 * Skeleton rows rather than a centred spinner: the table keeps its shape, so
 * the page does not jump when data lands.
 */
export function LoadingState({ rows = 5 }: { rows?: number; label?: string }) {
  return (
    <div className="divide-y divide-line" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="skeleton h-3.5 w-48" />
          <div className="skeleton h-3.5 flex-1" />
          <div className="skeleton h-3.5 w-28" />
          <div className="skeleton h-3.5 w-16" />
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
    <div className="px-6 py-16">
      <div className="mx-auto max-w-sm text-center">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{description}</p>
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="px-6 py-16" role="alert">
      <div className="mx-auto max-w-sm text-center">
        <p className="text-sm font-medium text-danger">Could not load this view</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{message}</p>
        {onRetry && (
          <div className="mt-4 flex justify-center">
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
      className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-[13px] text-danger"
    >
      {children}
    </div>
  );
}

/** A bordered container. The single panel primitive the whole app uses. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-surface ${className}`}>{children}</div>
  );
}
