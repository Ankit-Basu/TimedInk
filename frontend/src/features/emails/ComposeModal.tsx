import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { browserTimezone, datetimeLocalValue, localInputToUtcIso } from '../../lib/format';
import { Alert, Button, Field, Input, Textarea } from '../../components/ui';
import type { DeliverabilityPreview } from '../../lib/types';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_LEAD_MINUTES = 2;

export default function ComposeModal({ open, onClose }: ComposeModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const timezone = useMemo(() => browserTimezone(), []);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [scheduledAtLocal, setScheduledAtLocal] = useState(() =>
    datetimeLocalValue(DEFAULT_LEAD_MINUTES),
  );
  const [followUpAfterHours, setFollowUpAfterHours] = useState('');
  const [preview, setPreview] = useState<DeliverabilityPreview | null>(null);

  // Reset to a clean form (and a fresh default time) each time it opens.
  useEffect(() => {
    if (!open) return;
    setTo('');
    setCc('');
    setSubject('');
    setBody('');
    setScheduledAtLocal(datetimeLocalValue(DEFAULT_LEAD_MINUTES));
    setFollowUpAfterHours('');
    setPreview(null);
    // Land the caret in the first field rather than making the user click.
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const mutation = useMutation({
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
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
      showToast('success', 'Email scheduled', `Queued for ${data.to}.`);
      onClose();
    },
  });

  if (!open) return null;

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

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-ink/25 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      onMouseDown={(e) => {
        // Only dismiss on a click that both starts and ends on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto w-full max-w-2xl border border-rule-strong bg-surface">
        <div className="flex items-center justify-between border-b border-rule px-6 py-4">
          <h2 id="compose-title" className="display text-xl">
            Schedule an email
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-sm p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-7 px-6 py-7" noValidate>
          {errorMessage && <Alert>{errorMessage}</Alert>}

          <div className="grid gap-7 sm:grid-cols-2">
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

          <Field label="Subject" required>
            <Input
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
              rows={9}
              placeholder={'Hi there,\n\n…\n\nThanks,\nAva'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>

          {/* Bonus A — informational, never blocks the send. */}
          {preview && (
            <div className="border-l-2 border-rule-strong bg-surface-2 py-3.5 pl-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="label">Deliverability</span>
                <span className={`mono text-[13px] font-medium ${scoreTone}`}>
                  {preview.score}/100
                </span>
              </div>

              {preview.flags.length === 0 ? (
                <p className="mt-2 text-xs text-ink-3">No issues found.</p>
              ) : (
                <>
                  <ul className="mt-2 space-y-1">
                    {preview.flags.map((flag) => (
                      <li key={flag} className="text-xs leading-relaxed text-ink-2">
                        {flag}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-ink-3">
                    Informational only — this email will still be scheduled.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="grid gap-7 sm:grid-cols-2">
            <Field
              label="Send at"
              required
              hint={`Local time (${timezone}); converted to UTC on the way out.`}
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

          <div className="flex items-center justify-end gap-3 border-t border-rule pt-6">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Schedule
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
