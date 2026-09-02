import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ApiError, api } from '../../lib/api';
import { useToast } from '../../lib/toast';
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
  const { showToast } = useToast();
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

  // Word count helper
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  // Reset on open
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Live deliverability scoring (debounced)
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
        scheduledAt: localInputToUtcIso(scheduledAtLocal),
        timezone,
        ...(followUpAfterHours ? { followUpAfterHours: Number(followUpAfterHours) } : {}),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
      showToast(
        'success',
        'Email Scheduled',
        `Queued for ${data.to} · Scheduled ${new Date(scheduledAtLocal).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      );
      onClose();
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? err.fieldMessages.join(' · ') || err.message
          : 'Could not schedule this email.';
      showToast('error', 'Scheduling Failed', msg);
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
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#03050b]/78 backdrop-blur-2xl p-4 sm:p-6 md:p-10"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: 'spring', stiffness: 450, damping: 32 }}
          className="glass-panel w-full max-w-2xl elevation-4 overflow-hidden my-auto"
        >
          <div className="flex items-center justify-between border-b border-white/[0.09] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-aqua)]/25 bg-[var(--color-aqua)]/10 text-[var(--color-aqua)] shadow-[0_0_24px_rgba(85,214,190,0.12)]">
                <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <div>
                <h2 id="compose-title" className="text-base font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
                  Compose & Schedule
                </h2>
                <p className="text-[11px] text-slate-400">Delivery window guarded across restarts</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-xl p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-all"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5" noValidate>
            {errorMessage && <Alert>{errorMessage}</Alert>}

            {/* Recipients */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="To" required hint="Recipient email address.">
                <Input
                  type="text"
                  required
                  placeholder="prospect@company.com"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>

              <Field label="Cc" hint="Optional carbon copy.">
                <Input
                  type="text"
                  placeholder="team@company.com"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                />
              </Field>
            </div>

            {/* Subject */}
            <Field label="Subject" required>
              <Input
                type="text"
                required
                maxLength={998}
                placeholder="Personal note regarding your outbound flow"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>

            {/* Body with live word count & score header */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-300">
                  Message Body <span className="text-violet-400">*</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-500">
                    {wordCount} {wordCount === 1 ? 'word' : 'words'}
                  </span>
                  {preview && (
                    <DeliverabilityBadge score={preview.score} flags={preview.details} />
                  )}
                </div>
              </div>
              <Textarea
                required
                rows={7}
                placeholder={'Hi {{first_name}},\n\nNoticed you are scaling outbound infrastructure…\n\nBest,\nAlex'}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            {/* Deliverability Warnings preview if any */}
            {preview && preview.flags.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              className="rounded-xl bg-[var(--status-sending-bg)] border border-[var(--status-sending-ring)] px-3.5 py-2.5 text-xs text-[var(--status-sending)]"
            >
              <div className="flex items-center gap-1.5 font-semibold mb-1">
                  <span aria-hidden="true">!</span>
                  <span>{preview.flags.length} deliverability suggestion{preview.flags.length > 1 ? 's' : ''}:</span>
                </div>
                <ul className="space-y-0.5 opacity-90 pl-4 list-disc">
                  {preview.flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </motion.div>
            )}

            {/* Section Divider */}
            <div className="hairline-gradient-divider my-4" />

            {/* Scheduling Controls */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Send at"
                required
                hint={`Local time (${timezone}) converted to UTC on send.`}
              >
                <Input
                  type="datetime-local"
                  required
                  value={scheduledAtLocal}
                  onChange={(e) => setScheduledAtLocal(e.target.value)}
                />
              </Field>

              <Field
                label="Follow-up if unopened"
                hint="Auto-sends thread reply if tracking pixel unread."
              >
                <Input
                  type="number"
                  min={1}
                  max={720}
                  placeholder="e.g. 48 hours"
                  value={followUpAfterHours}
                  onChange={(e) => setFollowUpAfterHours(e.target.value)}
                />
              </Field>
            </div>

            {/* Actions */}
            <div className="aurora-line my-4" />

            <div className="flex items-center justify-end gap-3 pt-1">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Schedule email
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
