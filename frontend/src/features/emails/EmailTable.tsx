import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatDateTime, formatRelative } from '../../lib/format';
import { Button, DeliverabilityBadge, StatusBadge } from '../../components/ui';
import type { ScheduledEmail } from '../../lib/types';

const CANCELLABLE = new Set<ScheduledEmail['status']>(['PENDING', 'QUEUED']);

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function EmailTable({ emails }: { emails: ScheduledEmail[] }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelEmail(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
      showToast('success', 'Email cancelled', 'Its queued job was removed.');
    },
    onError: (error: unknown) => {
      showToast(
        'error',
        'Could not cancel',
        error instanceof Error ? error.message : 'Please try again.',
      );
    },
  });

  return (
    <div className="overflow-x-auto">
      {/*
        `table-fixed` with an explicit colgroup: column widths stay put as rows
        change, and the subject cell can ellipsis instead of collapsing into a
        one-word-per-line column when the viewport gets tight.
      */}
      <table className="w-full min-w-[940px] table-fixed text-left">
        <colgroup>
          <col className="w-[19%]" />
          <col className="w-[20%]" />
          <col className="w-[17%]" />
          <col className="w-[13%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[11%]" />
        </colgroup>

        <thead>
          <tr className="border-b border-rule">
            <th scope="col" className="label px-6 py-3 font-medium sm:px-8">Recipient</th>
            <th scope="col" className="label px-4 py-3 font-medium">Subject</th>
            <th scope="col" className="label px-4 py-3 font-medium">Scheduled</th>
            <th scope="col" className="label px-4 py-3 font-medium">From</th>
            <th scope="col" className="label px-4 py-3 font-medium">Score</th>
            <th scope="col" className="label px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-6 py-3 sm:px-8">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-rule">
          {emails.map((email) => (
            <tr key={email.id} className="align-top transition-colors hover:bg-surface-2/70">
              <td className="overflow-hidden px-6 py-4 sm:px-8">
                <div className="truncate text-[13px] text-ink" title={email.to}>
                  {email.to}
                </div>
                {email.cc && (
                  <div className="truncate text-xs text-ink-3" title={email.cc}>
                    cc {email.cc}
                  </div>
                )}
                {email.followUpOfId && <div className="label mt-1.5">Follow-up</div>}
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
                {email.attempts > 1 && (
                  <div className="mono mt-1 text-xs text-ink-3">{email.attempts} attempts</div>
                )}
              </td>

              <td className="overflow-hidden px-4 py-4">
                <div className="mono truncate text-[13px] text-ink-2">
                  {formatDateTime(email.scheduledAt)}
                </div>
                <div className="truncate text-xs text-ink-3">
                  {formatRelative(email.scheduledAt)}
                  {/* Only worth showing when it differs from the viewer's zone. */}
                  {email.timezone && email.timezone !== localZone && (
                    <span> · set in {email.timezone}</span>
                  )}
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
                <DeliverabilityBadge
                  score={email.deliverabilityScore}
                  flags={email.deliverabilityFlags}
                />
              </td>

              <td className="px-4 py-4 whitespace-nowrap">
                <StatusBadge status={email.status} />
                {email.openedAt && (
                  <div className="mt-1 text-xs text-ink-3">
                    opened {formatRelative(email.openedAt)}
                  </div>
                )}
              </td>

              <td className="px-6 py-4 text-right whitespace-nowrap sm:px-8">
                {email.previewUrl && (
                  <a
                    href={email.previewUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[13px] text-ink underline decoration-rule-strong underline-offset-4 transition-colors hover:decoration-ink"
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
