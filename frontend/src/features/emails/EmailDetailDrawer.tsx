import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { datetimeLocalValue, formatDateTime, formatRelative, localInputToUtcIso } from '../../lib/format';
import { Button, ErrorState, Field, Input, Spinner, StatusBadge } from '../../components/ui';
import type { EmailEvent, EmailEventType, ScheduledEmailDetail } from '../../lib/types';

interface Props {
  emailId: string | null;
  onClose: () => void;
  /** Opens the composer pre-filled from this email. */
  onDuplicate?: (email: ScheduledEmailDetail) => void;
}

const CANCELLABLE = new Set(['PENDING', 'QUEUED']);

/**
 * The event timeline for one email.
 *
 * Every status transition writes an immutable EmailEvent server-side, and this
 * is where that trail becomes useful: it is the answer to "why did this go out
 * at 3am", "how many times did we retry", and "did the reconciler touch this
 * after a restart". The list view can only show the *current* state; this shows
 * how it got there.
 */
export default function EmailDetailDrawer({ emailId, onClose, onDuplicate }: Props) {
  const open = emailId !== null;
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  const [rescheduling, setRescheduling] = useState(false);
  const [newTime, setNewTime] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['email', emailId],
    queryFn: () => api.getEmail(emailId!),
    enabled: open,
    // The timeline grows while an email is in flight, so keep it fresh.
    refetchInterval: 4000,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelEmail(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['email', emailId] });
      showToast('success', 'Email cancelled', 'Its queued job was removed.');
    },
    onError: (err: unknown) =>
      showToast('error', 'Could not cancel', err instanceof Error ? err.message : undefined),
  });

  const reschedule = useMutation({
    mutationFn: (scheduledAt: string) => api.rescheduleEmail(emailId!, scheduledAt),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email', emailId] });
      setRescheduling(false);
      showToast('success', 'Rescheduled', `Now going out ${formatDateTime(updated.scheduledAt)}.`);
    },
    onError: (err: unknown) =>
      showToast('error', 'Could not reschedule', err instanceof Error ? err.message : undefined),
  });

  // Close the inline reschedule form whenever the drawer changes email.
  useEffect(() => {
    setRescheduling(false);
  }, [emailId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-ink/25"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-rule-strong bg-surface"
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-rule bg-surface px-6 py-4">
          <h2 id="detail-title" className="display truncate text-xl">
            {data?.subject ?? 'Email'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-sm p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {isPending ? (
          <div className="flex items-center gap-2.5 px-6 py-16 text-[13px] text-ink-3">
            <Spinner className="h-4 w-4" /> Loading timeline…
          </div>
        ) : isError ? (
          <ErrorState error={error} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-rule px-6 py-6">
              <Detail label="Status">
                <StatusBadge status={data.status} />
              </Detail>
              <Detail label="Attempts">
                <span className="mono text-[13px]">{data.attempts}</span>
              </Detail>
              <Detail label="To">
                <span className="text-[13px] break-all">{data.to}</span>
              </Detail>
              <Detail label="From">
                <span className="text-[13px] break-all">{data.mailbox?.fromEmail ?? '—'}</span>
              </Detail>
              {data.cc && (
                <Detail label="Cc">
                  <span className="text-[13px] break-all">{data.cc}</span>
                </Detail>
              )}
              <Detail label="Scheduled">
                <span className="mono text-[13px]">{formatDateTime(data.scheduledAt)}</span>
                <span className="mt-0.5 block text-xs text-ink-3">{data.timezone}</span>
              </Detail>
              {data.sentAt && (
                <Detail label="Sent">
                  <span className="mono text-[13px]">{formatDateTime(data.sentAt)}</span>
                </Detail>
              )}
              {data.openedAt && (
                <Detail label="Opened">
                  <span className="mono text-[13px]">{formatDateTime(data.openedAt)}</span>
                </Detail>
              )}
              {data.followUpAfterHours && (
                <Detail label="Follow-up after">
                  <span className="mono text-[13px]">{data.followUpAfterHours}h if unopened</span>
                </Detail>
              )}
            </dl>

            {/* Bonus A — the flags behind the score, spelled out. */}
            {data.deliverabilityScore !== null && (
              <div className="border-b border-rule px-6 py-6">
                <div className="flex items-baseline justify-between">
                  <p className="label">Deliverability</p>
                  <span className="mono text-[13px] font-medium">
                    {data.deliverabilityScore}/100
                  </span>
                </div>
                {data.deliverabilityFlags.length === 0 ? (
                  <p className="mt-2 text-xs text-ink-3">No issues found.</p>
                ) : (
                  <ul className="mt-3 space-y-1.5">
                    {data.deliverabilityFlags.map((flag) => (
                      <li key={flag.code} className="text-xs leading-relaxed text-ink-2">
                        {flag.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {data.lastError && (
              <div className="border-b border-rule px-6 py-6">
                <p className="label mb-2">Last error</p>
                <p className="mono text-xs leading-relaxed break-words text-st-failed">
                  {data.lastError}
                </p>
              </div>
            )}

            <div className="border-b border-rule px-6 py-6">
              <p className="label mb-4">Timeline</p>
              <Timeline events={data.events} />
            </div>

            <div className="border-b border-rule px-6 py-6">
              <p className="label mb-3">Body</p>
              <pre className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">
                {data.bodyText}
              </pre>
            </div>

            {/*
              Reschedule uses BullMQ's changeDelay on the existing job rather
              than cancel-and-recreate, so the job keeps its identity.
            */}
            {CANCELLABLE.has(data.status) && rescheduling && (
              <div className="border-b border-rule px-6 py-6">
                <Field
                  label="New send time"
                  required
                  hint="Your local time, converted to UTC on the way out."
                >
                  <Input
                    type="datetime-local"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                  />
                </Field>
                <div className="mt-4 flex gap-3">
                  <Button
                    loading={reschedule.isPending}
                    disabled={!newTime}
                    onClick={() => reschedule.mutate(localInputToUtcIso(newTime))}
                  >
                    Move it
                  </Button>
                  <Button variant="secondary" onClick={() => setRescheduling(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 px-6 py-6">
              {data.previewUrl && (
                <Button variant="secondary" onClick={() => window.open(data.previewUrl!, '_blank')}>
                  Open preview ↗
                </Button>
              )}

              {onDuplicate && (
                <Button variant="secondary" onClick={() => onDuplicate(data)}>
                  Duplicate
                </Button>
              )}

              {CANCELLABLE.has(data.status) && !rescheduling && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNewTime(datetimeLocalValue(15));
                    setRescheduling(true);
                  }}
                >
                  Reschedule
                </Button>
              )}

              {CANCELLABLE.has(data.status) && (
                <Button
                  variant="danger"
                  loading={cancel.isPending}
                  onClick={() => cancel.mutate(data.id)}
                >
                  Cancel send
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="label mb-1.5">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Dot colour per event type — same language as the status column. */
const EVENT_DOT: Record<EmailEventType, string> = {
  CREATED: 'bg-st-pending',
  QUEUED: 'bg-st-queued',
  SENDING: 'bg-st-sending',
  SENT: 'bg-st-sent',
  FAILED: 'bg-st-failed',
  CANCELLED: 'bg-st-cancelled',
  OPENED: 'bg-accent',
  PENDING: 'bg-st-pending',
};

/**
 * Pull the two or three fields worth showing out of the event's `meta` JSON.
 * The column is free-form, so this reads defensively rather than casting.
 */
function metaSummary(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const m = meta as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof m.delayMs === 'number') parts.push(`delay ${Math.round(m.delayMs / 1000)}s`);
  if (typeof m.attempt === 'number') {
    parts.push(`attempt ${m.attempt}${typeof m.maxAttempts === 'number' ? `/${m.maxAttempts}` : ''}`);
  }
  if (typeof m.source === 'string') parts.push(m.source);
  if (typeof m.reason === 'string') parts.push(m.reason);
  if (typeof m.error === 'string') parts.push(m.error);
  if (typeof m.deliverabilityScore === 'number') parts.push(`score ${m.deliverabilityScore}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function Timeline({ events }: { events: EmailEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-ink-3">No events recorded yet.</p>;
  }

  return (
    <ol className="relative">
      {/* The spine the dots hang off. */}
      <span className="absolute top-1 bottom-1 left-[3px] w-px bg-rule" aria-hidden="true" />

      {events.map((event) => {
        const summary = metaSummary(event.meta);
        return (
          <li key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
            <span
              className={`z-10 mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full ring-2 ring-surface ${
                EVENT_DOT[event.type] ?? 'bg-st-pending'
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="label text-ink">{event.type}</span>
                <span className="mono text-xs text-ink-3">
                  {formatDateTime(event.createdAt)} · {formatRelative(event.createdAt)}
                </span>
              </div>
              {summary && (
                <p className="mono mt-1 text-xs leading-relaxed break-words text-ink-3">
                  {summary}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
