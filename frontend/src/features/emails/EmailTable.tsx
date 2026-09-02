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
      <table className="w-full min-w-[940px] table-fixed text-left text-[13px]">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[21%]" />
          <col className="w-[16%]" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
          <col className="w-[9%]" />
          <col className="w-[13%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-xs font-medium text-fg-muted">
            <th scope="col" className="px-4 py-2.5 font-medium">Recipient</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Subject</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Scheduled</th>
            <th scope="col" className="px-4 py-2.5 font-medium">From</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Score</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-line">
          {emails.map((email) => (
            <tr key={email.id} className="align-top transition-colors hover:bg-surface-2">
              <td className="px-4 py-3">
                <div className="truncate text-fg" title={email.to}>{email.to}</div>
                {email.cc && (
                  <div className="truncate text-xs text-fg-muted" title={email.cc}>cc {email.cc}</div>
                )}
                {email.followUpOfId && (
                  <div className="mt-1 text-xs text-fg-muted">follow-up</div>
                )}
              </td>

              <td className="px-4 py-3">
                <div className="truncate text-fg-secondary" title={email.subject}>
                  {email.subject}
                </div>
                {email.lastError && (
                  <div className="truncate text-xs text-st-failed" title={email.lastError}>
                    {email.lastError}
                  </div>
                )}
                {email.attempts > 1 && (
                  <div className="tabular mt-1 text-xs text-fg-muted">
                    {email.attempts} attempts
                  </div>
                )}
              </td>

              <td className="px-4 py-3 whitespace-nowrap">
                <div className="tabular text-fg-secondary">{formatDateTime(email.scheduledAt)}</div>
                <div className="mt-0.5 text-xs text-fg-muted">
                  {formatRelative(email.scheduledAt)}
                  {/* Only worth showing when it differs from the viewer's zone. */}
                  {email.timezone && email.timezone !== localZone && (
                    <span> · set in {email.timezone}</span>
                  )}
                </div>
              </td>

              <td className="px-4 py-3 text-fg-secondary">
                {email.mailbox ? (
                  <span className="block truncate" title={email.mailbox.fromEmail}>
                    {email.mailbox.fromEmail}
                  </span>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </td>

              <td className="px-4 py-3 whitespace-nowrap">
                <DeliverabilityBadge
                  score={email.deliverabilityScore}
                  flags={email.deliverabilityFlags}
                />
              </td>

              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={email.status} />
                {email.openedAt && (
                  <div className="mt-0.5 text-xs text-fg-muted">
                    opened {formatRelative(email.openedAt)}
                  </div>
                )}
              </td>

              <td className="px-4 py-3 text-right whitespace-nowrap">
                <div className="flex items-center justify-end gap-1.5">
                  {email.previewUrl && (
                    <a
                      href={email.previewUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex h-7 items-center rounded-md border border-line px-2.5 text-xs
                        text-fg-secondary transition-colors hover:border-line-strong hover:text-fg"
                    >
                      Preview
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
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
