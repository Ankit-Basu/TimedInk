import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { browserTimezone, datetimeLocalValue, formatDateTime, localInputToUtcIso } from '../../lib/format';
import { readLeadsFile } from '../../lib/csv';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { gsap, prefersReducedMotion } from '../../lib/motion';
import { Alert, Button, CloseIcon, Field, Input, Textarea } from '../../components/ui';
import type { DeliverabilityPreview } from '../../lib/types';

/** Pre-filled fields, used by "Duplicate" on an existing email. */
export interface ComposeDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  followUpAfterHours: string;
}

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  /** When present the form opens pre-filled instead of blank. */
  draft?: ComposeDraft | null;
}

type Mode = 'single' | 'bulk';

const DEFAULT_LEAD_MINUTES = 2;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Mirror of the server's planBulkSchedule, so the form can show when the last
 * email will go out before anything is submitted.
 */
function lastSendAt(count: number, start: Date, delayMs: number, hourlyLimit: number | null): Date | null {
  if (count === 0 || Number.isNaN(start.getTime())) return null;
  const i = count - 1;
  let at = start.getTime() + i * delayMs;
  if (hourlyLimit && hourlyLimit > 0) {
    at = Math.max(at, start.getTime() + Math.floor(i / hourlyLimit) * HOUR_MS + (i % hourlyLimit) * delayMs);
  }
  return new Date(at);
}

export default function ComposeModal({ open, onClose, draft }: ComposeModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const timezone = useMemo(() => browserTimezone(), []);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Holds Tab inside the dialog and restores focus to the trigger on close.
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  const [mode, setMode] = useState<Mode>('single');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [scheduledAtLocal, setScheduledAtLocal] = useState(() => datetimeLocalValue(DEFAULT_LEAD_MINUTES));
  const [followUpAfterHours, setFollowUpAfterHours] = useState('');
  const [preview, setPreview] = useState<DeliverabilityPreview | null>(null);

  // Bulk-only state.
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState('5');
  const [hourlyLimit, setHourlyLimit] = useState('');

  const throughput = useQuery({
    queryKey: ['throughput'],
    queryFn: () => api.throughput(),
    enabled: open,
    staleTime: 30_000,
  });

  // Reset each time it opens — blank, or pre-filled from a draft. The send time
  // is always fresh: copying an old email should not copy a time in the past.
  useEffect(() => {
    if (!open) return;
    setMode('single');
    setTo(draft?.to ?? '');
    setCc(draft?.cc ?? '');
    setSubject(draft?.subject ?? '');
    setBody(draft?.body ?? '');
    setScheduledAtLocal(datetimeLocalValue(DEFAULT_LEAD_MINUTES));
    setFollowUpAfterHours(draft?.followUpAfterHours ?? '');
    setPreview(null);
    setRecipients([]);
    setFileName(null);
    setDuplicates(0);
    // Land the caret in the first field rather than making the user click.
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  }, [open, draft]);

  // Entrance: backdrop fades, the dialog rises out of a blur.
  useEffect(() => {
    if (!open || prefersReducedMotion()) return;
    const tl = gsap.timeline();
    tl.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' });
    tl.fromTo(
      dialogRef.current,
      { opacity: 0, y: 30, scale: 0.97, filter: 'blur(8px)' },
      { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.55, ease: 'expo.out' },
      '<0.05',
    );
    return () => {
      tl.kill();
    };
  }, [open, dialogRef]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    // Stop the page behind the dialog scrolling under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  /**
   * Live deliverability preview (bonus A). Debounced so typing does not fire a
   * request per keystroke; the endpoint is a pure function with no writes.
   */
  useEffect(() => {
    if (!open) return;
    if (!subject && !body) {
      setPreview(null);
      return;
    }

    const handle = setTimeout(() => {
      api
        .previewScore(subject, body)
        .then(setPreview)
        // A failed preview must never block composing.
        .catch(() => setPreview(null));
    }, 350);

    return () => clearTimeout(handle);
  }, [open, subject, body]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['emails'] });
    void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
  };

  const single = useMutation({
    mutationFn: () =>
      api.createEmail({
        to: to.trim(),
        ...(cc.trim() ? { cc: cc.trim() } : {}),
        subject: subject.trim(),
        body,
        // The picker gives naive local wall-clock; convert to an absolute UTC
        // instant before it leaves the browser. The server stores UTC only.
        scheduledAt: localInputToUtcIso(scheduledAtLocal),
        timezone,
        ...(followUpAfterHours ? { followUpAfterHours: Number(followUpAfterHours) } : {}),
      }),
    onSuccess: (data) => {
      invalidate();
      showToast('success', 'Email scheduled', `Queued for ${data.to}.`);
      onClose();
    },
  });

  const bulk = useMutation({
    mutationFn: () =>
      api.createBulk({
        recipients,
        subject: subject.trim(),
        body,
        startAt: localInputToUtcIso(scheduledAtLocal),
        delayBetweenSeconds: Number(delaySeconds) || 0,
        ...(hourlyLimit ? { hourlyLimit: Number(hourlyLimit) } : {}),
        timezone,
        ...(followUpAfterHours ? { followUpAfterHours: Number(followUpAfterHours) } : {}),
      }),
    onSuccess: (data) => {
      invalidate();
      showToast(
        'success',
        `${data.count} emails scheduled`,
        data.lastAt ? `Last one goes out ${formatDateTime(data.lastAt)}.` : undefined,
      );
      onClose();
    },
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await readLeadsFile(file);
      setRecipients(parsed.emails);
      setDuplicates(parsed.duplicates);
      setFileName(file.name);
      if (parsed.emails.length === 0) {
        showToast('error', 'No email addresses found', `Nothing in ${file.name} looked like an address.`);
      }
    } catch (err) {
      showToast('error', 'Could not read that file', err instanceof Error ? err.message : undefined);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files[0]);
  };

  if (!open) return null;

  const mutation = mode === 'single' ? single : bulk;
  const error = mutation.error;
  const errorMessage =
    error instanceof ApiError
      ? error.fieldMessages.join(' · ') || error.message
      : error
        ? 'Could not schedule this email.'
        : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const scoreTone =
    preview === null
      ? ''
      : preview.score >= 80
        ? 'text-st-sent'
        : preview.score >= 50
          ? 'text-st-sending'
          : 'text-st-failed';

  const bulkMax = throughput.data?.bulkMaxRecipients ?? 1000;
  const overMax = recipients.length > bulkMax;
  const finish = lastSendAt(
    recipients.length,
    new Date(scheduledAtLocal),
    (Number(delaySeconds) || 0) * 1000,
    hourlyLimit ? Number(hourlyLimit) : null,
  );

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-40 overflow-y-auto bg-night/70 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      onMouseDown={(e) => {
        // Only dismiss on a click that both starts and ends on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="glass-strong ring-gradient mx-auto w-full max-w-2xl rounded-[28px]">
        <div className="flex items-center justify-between gap-4 px-6 pt-6 sm:px-7">
          <div>
            <h2 id="compose-title" className="headline text-3xl">
              {draft ? 'Duplicate email' : 'Compose'}
            </h2>
            <p className="mt-1 text-[13px] text-ink-3">Scheduled as a delayed BullMQ job — survives restarts.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl text-ink-3 transition-colors hover:bg-white/10 hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Mode switch: one recipient, or a CSV of leads. */}
        <div className="px-6 pt-5 sm:px-7">
          <div className="well relative grid grid-cols-2 rounded-2xl p-1" role="tablist" aria-label="Recipients">
            <span
              className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl bg-gradient-to-b from-[#ffc56b] to-[#f2862e] shadow-[0_4px_20px_-4px_rgb(255_165_60/0.6)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ transform: mode === 'bulk' ? 'translateX(100%)' : 'translateX(0)' }}
              aria-hidden="true"
            />
            {(
              [
                ['single', 'Single email'],
                ['bulk', 'Bulk from CSV'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`relative z-10 h-9 cursor-pointer rounded-xl text-[13px] font-medium transition-colors ${
                  mode === value ? 'text-night font-semibold' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6 sm:px-7" noValidate>
          {errorMessage && <Alert>{errorMessage}</Alert>}

          {mode === 'single' ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="To" required hint="One address, or several separated by commas.">
                <Input
                  ref={firstFieldRef}
                  type="text"
                  required
                  placeholder="prospect@example.com"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>

              <Field label="Cc">
                <Input
                  type="text"
                  placeholder="colleague@example.com"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                />
              </Field>
            </div>
          ) : (
            <Field
              label="Leads file"
              required
              aside={
                recipients.length > 0 ? (
                  <span className={`mono text-xs ${overMax ? 'text-st-failed' : 'text-st-sent'}`}>
                    {recipients.length.toLocaleString()} email{recipients.length === 1 ? '' : 's'} detected
                  </span>
                ) : undefined
              }
              hint={
                overMax
                  ? undefined
                  : `CSV or .txt — addresses are found wherever they are in the file. Up to ${bulkMax.toLocaleString()} per batch.`
              }
              error={overMax ? `That is more than ${bulkMax.toLocaleString()} — split the file.` : undefined}
            >
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
                className={`group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all duration-300 ${
                  dragging
                    ? 'scale-[1.01] border-accent bg-accent/10'
                    : 'border-white/15 bg-black/20 hover:border-accent/60 hover:bg-white/[0.04]'
                }`}
              >
                <span className="ring-gradient grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.06] transition-transform duration-300 group-hover:-translate-y-1">
                  <svg className="h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {fileName ? (
                  <span className="text-sm text-ink">
                    <span className="font-medium">{fileName}</span>
                    {duplicates > 0 && <span className="text-ink-3"> · {duplicates} duplicate{duplicates === 1 ? '' : 's'} removed</span>}
                    <span className="mt-1 block text-xs text-ink-3">Click or drop to replace</span>
                  </span>
                ) : (
                  <span className="text-sm text-ink-2">
                    <span className="font-medium text-ink">Drop a CSV here</span> or click to browse
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>

              {recipients.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {recipients.slice(0, 8).map((email) => (
                    <span key={email} className="mono rounded-full border border-edge bg-white/[0.05] px-2.5 py-1 text-[11px] text-ink-2">
                      {email}
                    </span>
                  ))}
                  {recipients.length > 8 && (
                    <span className="mono rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
                      +{(recipients.length - 8).toLocaleString()} more
                    </span>
                  )}
                </div>
              )}
            </Field>
          )}

          <Field label="Subject" required>
            <Input
              ref={mode === 'bulk' ? firstFieldRef : undefined}
              type="text"
              required
              maxLength={998}
              placeholder="Quick question about your outbound stack"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>

          <Field label="Body" required>
            <Textarea
              required
              rows={7}
              placeholder={'Hi there,\n\n…\n\nThanks,\nAva'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>

          {/* Bonus A — informational, never blocks the send. */}
          {preview && (
            <div className="well rounded-2xl px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="label">Deliverability</span>
                <span className={`mono text-[13px] font-medium ${scoreTone}`}>{preview.score}/100</span>
              </div>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber via-ember to-plum transition-[width] duration-700"
                  style={{ width: `${preview.score}%` }}
                />
              </div>
              {preview.flags.length === 0 ? (
                <p className="mt-2.5 text-xs text-ink-3">No issues found.</p>
              ) : (
                <ul className="mt-2.5 space-y-1">
                  {preview.flags.map((flag) => (
                    <li key={flag} className="text-xs leading-relaxed text-ink-2">
                      · {flag}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={mode === 'bulk' ? 'Start time' : 'Send at'}
              required
              hint={`Your local time (${timezone}); stored as UTC.`}
            >
              <Input
                type="datetime-local"
                required
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
              />
            </Field>

            <Field label="Follow up if unopened" hint="Hours to wait before following up.">
              <Input
                type="number"
                min={1}
                max={720}
                placeholder="48"
                value={followUpAfterHours}
                onChange={(e) => setFollowUpAfterHours(e.target.value)}
              />
            </Field>
          </div>

          {mode === 'bulk' && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Delay between emails" required hint="Seconds between consecutive recipients.">
                  <Input
                    type="number"
                    min={0}
                    max={86400}
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(e.target.value)}
                  />
                </Field>
                <Field
                  label="Hourly limit"
                  hint={
                    throughput.data
                      ? `Server caps: ${throughput.data.maxPerHour}/h overall, ${throughput.data.maxPerHourPerSender}/h per sender.`
                      : 'Most emails this batch may send per hour.'
                  }
                >
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    placeholder="e.g. 30"
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(e.target.value)}
                  />
                </Field>
              </div>

              {finish && (
                <div className="flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent/[0.08] px-4 py-3 text-[13px] text-ink-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" aria-hidden="true" />
                  <span>
                    {recipients.length.toLocaleString()} emails, first at{' '}
                    <span className="mono text-ink">{formatDateTime(new Date(scheduledAtLocal).toISOString())}</span>, last at{' '}
                    <span className="mono text-ink">{formatDateTime(finish.toISOString())}</span>
                  </span>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-edge pt-5">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={mode === 'bulk' && (recipients.length === 0 || overMax)}
            >
              {mode === 'bulk' && recipients.length > 0
                ? `Schedule ${recipients.length.toLocaleString()} emails`
                : 'Schedule'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
