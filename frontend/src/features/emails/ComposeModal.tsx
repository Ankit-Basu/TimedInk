import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import { browserTimezone, datetimeLocalValue, localInputToUtcIso } from '../../lib/format';
import { Alert, Button, DeliverabilityBadge, Field, Input, Textarea } from '../../components/ui';
import type { DeliverabilityPreview } from '../../lib/types';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_LEAD_MINUTES = 2;

export default function ComposeModal({ open, onClose }: ComposeModalProps) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => browserTimezone(), []);

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
  }, [open]);

  // Close on Escape — cheap, and expected of a modal.
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
        .catch(() => setPreview(null)); // a failed preview must never block composing
    }, 400);

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      onMouseDown={(e) => {
        // Only dismiss on a click that both starts and ends on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl glass-panel shadow-2xl animate-scale-in gradient-border">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500">
              <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h2 id="compose-title" className="text-base font-bold text-white" style={{ fontFamily: 'var(--font-heading)' }}>
              Schedule an email
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-300 transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6" noValidate>
          {errorMessage && <Alert>{errorMessage}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="To" required hint="One address, or several separated by commas.">
              <Input
                type="text"
                required
                placeholder="prospect@example.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>

            <Field label="Cc" hint="Optional.">
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
              rows={8}
              placeholder={'Hi there,\n\n…\n\nThanks,\nAva'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>

          {/* Bonus A — informational, never blocks the send. */}
          {preview && (
            <div className="rounded-xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.08] backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <DeliverabilityBadge score={preview.score} flags={preview.details} />
                <span className="text-sm font-medium text-slate-300">
                  Deliverability score
                </span>
                <span className="text-xs text-slate-500">
                  {preview.flags.length === 0
                    ? 'No issues found.'
                    : `${preview.flags.length} ${preview.flags.length === 1 ? 'issue' : 'issues'} — this email will still be scheduled.`}
                </span>
              </div>
              {preview.flags.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {preview.flags.map((flag) => (
                    <li key={flag}>• {flag}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Send at"
              required
              hint={`Your local time (${timezone}), converted to UTC on the way out.`}
            >
              <Input
                type="datetime-local"
                required
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
              />
            </Field>

            <Field
              label="Follow up if unopened"
              hint="Optional. Hours to wait before sending a follow-up."
            >
              <Input
                type="number"
                min={1}
                max={720}
                placeholder="e.g. 48"
                value={followUpAfterHours}
                onChange={(e) => setFollowUpAfterHours(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              Schedule email
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
