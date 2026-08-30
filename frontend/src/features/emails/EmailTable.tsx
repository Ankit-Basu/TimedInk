import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDateTime, formatRelative, truncate } from '../../lib/format';
import { Button, DeliverabilityBadge, StatusBadge } from '../../components/ui';
import type { ScheduledEmail } from '../../lib/types';

const CANCELLABLE = new Set(['PENDING', 'QUEUED']);

export default function EmailTable({ emails }: { emails: ScheduledEmail[] }) {
  const queryClient = useQueryClient();

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelEmail(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
    },
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr className="text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
            <th scope="col" className="px-6 py-3">Recipient</th>
            <th scope="col" className="px-6 py-3">Subject</th>
            <th scope="col" className="px-6 py-3">Scheduled</th>
            <th scope="col" className="px-6 py-3">From</th>
            <th scope="col" className="px-6 py-3">Score</th>
            <th scope="col" className="px-6 py-3">Status</th>
            <th scope="col" className="px-6 py-3 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {emails.map((email) => (
            <tr key={email.id} className="align-top hover:bg-slate-50/60">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="font-medium text-slate-900">{email.to}</div>
                {email.cc && <div className="text-xs text-slate-500">cc {email.cc}</div>}
                {email.followUpOfId && (
                  <span className="mt-1 inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                    follow-up
                  </span>
                )}
              </td>

              <td className="max-w-xs px-6 py-4">
                <div className="text-slate-800">{truncate(email.subject, 64)}</div>
                {email.lastError && (
                  <div className="mt-1 text-xs text-red-600" title={email.lastError}>
                    {truncate(email.lastError, 80)}
                  </div>
                )}
                {email.attempts > 1 && (
                  <div className="mt-1 text-xs text-slate-400">{email.attempts} attempts</div>
                )}
              </td>

              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-slate-800">{formatDateTime(email.scheduledAt)}</div>
                <div className="text-xs text-slate-500">
                  {formatRelative(email.scheduledAt)}
                  {/* Show the composing zone when it differs from the viewer's. */}
                  {email.timezone && email.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
                    <span className="ml-1 text-slate-400">· set in {email.timezone}</span>
                  )}
                </div>
              </td>

              <td className="px-6 py-4 whitespace-nowrap">
                {email.mailbox ? (
                  <span className="text-xs text-slate-600" title={email.mailbox.fromEmail}>
                    {email.mailbox.fromEmail}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </td>

              <td className="px-6 py-4 whitespace-nowrap">
                <DeliverabilityBadge
                  score={email.deliverabilityScore}
                  flags={email.deliverabilityFlags}
                />
              </td>

              <td className="px-6 py-4 whitespace-nowrap">
                <StatusBadge status={email.status} />
                {email.openedAt && (
                  <div className="mt-1 text-[11px] text-emerald-600">
                    opened {formatRelative(email.openedAt)}
                  </div>
                )}
              </td>

              <td className="px-6 py-4 text-right whitespace-nowrap">
                <div className="flex items-center justify-end gap-2">
                  {email.previewUrl && (
                    <a
                      href={email.previewUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                    >
                      View email ↗
                    </a>
                  )}

                  {CANCELLABLE.has(email.status) && (
                    <Button
                      variant="danger"
                      className="px-2 py-1 text-xs"
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
