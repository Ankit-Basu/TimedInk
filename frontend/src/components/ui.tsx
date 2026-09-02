import type { ButtonHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react';
import type { EmailStatus } from '../lib/types';

/**
 * Shared UI vocabulary.
 *
 * Everything is built from three moves: a hairline rule, a flat surface, and
 * the amber accent used sparingly. No shadows, no gradients — if two things
 * need separating, a 1px rule does it.
 */

// --- buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  // Dark text on amber, as the accent is too light to carry white legibly.
  primary: 'bg-accent text-ink border border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-surface text-ink border border-rule-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:text-ink hover:bg-surface-2',
  danger: 'bg-transparent text-danger border border-rule-strong hover:border-danger/60 hover:bg-surface-2',
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
  const sizing = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : 'h-9 px-4 text-[13px] gap-2';

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm font-medium
        transition-colors disabled:cursor-not-allowed disabled:opacity-40
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
        "required" is noise that reads like an error. Mark the exceptions.
      */}
      <span className="label mb-2 flex items-baseline gap-2">
        {label}
        {!required && <span className="normal-case tracking-normal opacity-70">optional</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-2 block text-xs text-ink-3">{hint}</span>}
      {error && (
        <span role="alert" className="mt-2 block text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

/*
  Underline-only inputs. A boxed control would add a second rectangle inside a
  layout already built from rules; a baseline rule keeps the form reading as
  ruled paper.
*/
const CONTROL =
  'block w-full border-0 border-b border-rule-strong bg-transparent px-0 py-2 text-sm text-ink ' +
  'placeholder:text-ink-3/70 transition-colors hover:border-ink-3 ' +
  'focus:border-ink focus:outline-none focus-visible:outline-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export const Input = ({ className = '', ...rest }: ComponentPropsWithRef<'input'>) => (
  <input {...rest} className={`${CONTROL} ${className}`} />
);

export const Textarea = ({ className = '', ...rest }: ComponentPropsWithRef<'textarea'>) => (
  <textarea {...rest} className={`${CONTROL} resize-y ${className}`} />
);

// --- status ----------------------------------------------------------------

/**
 * A dot plus a word. The dot carries the state when you are scanning a column;
 * the word makes it unambiguous and keeps it readable for anyone who cannot
 * separate the hues.
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

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span className={`label flex items-center gap-2 ${STATUS_TEXT[status]}`}>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]} ${
          status === 'SENDING' ? 'animate-pulse' : ''
        }`}
        aria-hidden="true"
      />
      {status}
    </span>
  );
}

/**
 * Bonus A — deliverability score.
 *
 * A figure out of 100 over a short rule that fills to match. The flags sit in
 * the `title` so the detail is one hover away without a tooltip library.
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
  const bar = score >= 80 ? 'bg-st-sent' : score >= 50 ? 'bg-st-sending' : 'bg-st-failed';

  const title =
    flags.length === 0
      ? 'No deliverability issues found'
      : `${flags.length} issue${flags.length === 1 ? '' : 's'}:\n${flags
          .map((f) => `• ${f.message}`)
          .join('\n')}`;

  return (
    <span className="inline-flex cursor-default flex-col gap-1.5" title={title}>
      <span className={`mono text-[13px] leading-none font-medium ${tone}`}>{score}</span>
      <span className="block h-px w-10 bg-rule" aria-hidden="true">
        <span className={`block h-px ${bar}`} style={{ width: `${score}%` }} />
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
    <div className="divide-y divide-rule" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-6 py-4">
          <div className="skeleton h-3 w-44" />
          <div className="skeleton h-3 flex-1" />
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-3 w-14" />
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
        <p className="display text-2xl text-ink">{title}</p>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{description}</p>
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
        <p className="display text-2xl text-danger">Could not load this view</p>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{message}</p>
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
      className="border-l-2 border-danger bg-danger/5 py-2 pl-3 text-[13px] text-danger"
    >
      {children}
    </div>
  );
}

/** A ruled container. The single panel primitive the app uses. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-rule bg-surface ${className}`}>{children}</div>;
}
