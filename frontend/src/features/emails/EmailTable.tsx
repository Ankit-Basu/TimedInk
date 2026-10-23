import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatDateTime, formatRelative } from '../../lib/format';
import { gsap, prefersReducedMotion, useGSAP } from '../../lib/motion';
import { Button, DeliverabilityBadge, StatusBadge } from '../../components/ui';
import type { ScheduledEmail } from '../../lib/types';

const CANCELLABLE = new Set<ScheduledEmail['status']>(['PENDING', 'QUEUED']);

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function EmailTable({
  emails,
  onSelect,
  variant = 'scheduled',
}: {
  emails: ScheduledEmail[];
  onSelect: (id: string) => void;
  /** Sent-style tabs show when it went out; the rest show when it is due. */
  variant?: 'scheduled' | 'sent';
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  /*
    Rows cascade in when the *set* of rows changes (a new tab, page or search)
    — but not on every 4-second poll, which would make the table twitch. The
    joined ids are the dependency for exactly that reason.
  */
  const rowKey = emails.map((e) => e.id).join(',');
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from('tr', {
        opacity: 0,
        y: 14,
        duration: 0.55,
        ease: 'expo.out',
        stagger: 0.035,
        clearProps: 'transform,opacity',
      });
    },
    { scope: bodyRef, dependencies: [rowKey] },
  );

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelEmail(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
      showToast('success', 'Email cancelled', 'Its queued job was removed.');
    },
    onError: (error: unknown) => {
      showToast('error', 'Could not cancel', error instanceof Error ? error.message : 'Please try again.');
    },
  });

  const timeHeading = variant === 'sent' ? 'Sent' : 'Scheduled';

  return (
    <div className="overflow-x-auto">
      {/*
        `table-fixed` with an explicit colgroup: column widths stay put as rows
        change, and the subject cell can ellipsis instead of collapsing into a
        one-word-per-line column when the viewport gets tight.
      */}
      <table className="w-full min-w-[940px] table-fixed text-left">
        <colgroup>
          <col className="w-[21%]" />
          <col className="w-[23%]" />
          <col className="w-[16%]" />
          <col className="w-[13%]" />
          <col className="w-[7%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
        </colgroup>

        <thead>
          <tr className="border-b border-edge">
            <th scope="col" className="label px-6 py-3.5 font-medium">Recipient</th>
            <th scope="col" className="label px-4 py-3.5 font-medium">Subject</th>
            <th scope="col" className="label px-4 py-3.5 font-medium">{timeHeading}</th>
            <th scope="col" className="label px-4 py-3.5 font-medium">From</th>
            <th scope="col" className="label px-4 py-3.5 font-medium">Score</th>
            <th scope="col" className="label px-4 py-3.5 font-medium">Status</th>
            <th scope="col" className="px-6 py-3.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody ref={bodyRef} className="divide-y divide-edge">
          {emails.map((email) => {
            const shownAt = variant === 'sent' ? (email.sentAt ?? email.scheduledAt) : email.scheduledAt;
            return (
              <tr key={email.id} className="group align-top transition-colors duration-200 hover:bg-white/[0.04]">
                <td className="relative overflow-hidden px-6 py-4">
                  {/* Accent bar that slides in on hover. */}
                  <span
                    className="absolute top-3 bottom-3 left-0 w-[2px] origin-center scale-y-0 rounded-full bg-gradient-to-b from-amber to-plum transition-transform duration-300 group-hover:scale-y-100"
                    aria-hidden="true"
                  />
                  {/*
                    The recipient doubles as the row's affordance. A clickable
                    <tr> is not reachable by keyboard and has no accessible role,
                    so the trigger is a real button in the first cell.
                  */}
                  <button
                    type="button"
                    onClick={() => onSelect(email.id)}
                    title={email.to}
                    className="block w-full cursor-pointer truncate text-left text-[13px] font-medium text-ink transition-colors hover:text-accent"
                  >
                    {email.to}
                  </button>
                  {email.cc && (
                    <div className="truncate text-xs text-ink-3" title={email.cc}>
                      cc {email.cc}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {email.followUpOfId && (
                      <span className="mono rounded-md bg-ember/10 px-1.5 py-0.5 text-[10px] text-ember">FOLLOW-UP</span>
                    )}
                    {email.batchId && (
                      <span className="mono rounded-md bg-plum/10 px-1.5 py-0.5 text-[10px] text-plum" title={`Batch ${email.batchId}`}>
                        BULK
                      </span>
                    )}
                  </div>
                </td>

                <td className="overflow-hidden px-4 py-4">
                  <div className="truncate text-[13px] text-ink-2" title={email.subject}>
                    {email.subject}
                  </div>
                  {email.lastError && (
                    <div className="truncate text-xs text-st-failed" title={email.lastError}>
                      {email.lastError}
                    </div>
                  )}
                  {email.attempts > 1 && <div className="mono mt-1 text-xs text-ink-3">{email.attempts} attempts</div>}
                </td>

                <td className="overflow-hidden px-4 py-4">
                  <div className="mono truncate text-[13px] text-ink-2">{formatDateTime(shownAt)}</div>
                  <div className="truncate text-xs text-ink-3">
                    {formatRelative(shownAt)}
                    {/* Only worth showing when it differs from the viewer's zone. */}
                    {email.timezone && email.timezone !== localZone && <span> · set in {email.timezone}</span>}
                  </div>
                </td>

                <td className="overflow-hidden px-4 py-4 text-[13px] text-ink-2">
                  {email.mailbox ? (
                    <span className="block truncate" title={email.mailbox.fromEmail}>
                      {email.mailbox.fromEmail}
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>

                <td className="px-4 py-4 whitespace-nowrap">
                  <DeliverabilityBadge score={email.deliverabilityScore} flags={email.deliverabilityFlags} />
                </td>

                <td className="px-4 py-4 whitespace-nowrap">
                  <StatusBadge status={email.status} />
                  {email.openedAt && <div className="mt-1.5 text-xs text-ink-3">opened {formatRelative(email.openedAt)}</div>}
                </td>

                <td className="px-6 py-4 text-right whitespace-nowrap">
                  {email.previewUrl && (
                    <a
                      href={email.previewUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 rounded-lg border border-edge bg-white/[0.05] px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent/50 hover:bg-accent/10"
                    >
                      Preview ↗
                    </a>
                  )}

                  {CANCELLABLE.has(email.status) && (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={cancel.isPending && cancel.variables === email.id}
                      onClick={() => cancel.mutate(email.id)}
                    >
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
