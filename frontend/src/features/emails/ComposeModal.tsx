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
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      onMouseDown={(e) => {
        // Only dismiss on a click that both starts and ends on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="compose-title" className="text-base font-semibold text-slate-900">
            Schedule an email
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5" noValidate>
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
            <div className="rounded-md bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <DeliverabilityBadge score={preview.score} flags={preview.details} />
                <span className="text-sm font-medium text-slate-700">
                  Deliverability score
                </span>
                <span className="text-xs text-slate-500">
                  {preview.flags.length === 0
                    ? 'No issues found.'
                    : `${preview.flags.length} ${preview.flags.length === 1 ? 'issue' : 'issues'} — this email will still be scheduled.`}
                </span>
              </div>
              {preview.flags.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
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

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Schedule email
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
