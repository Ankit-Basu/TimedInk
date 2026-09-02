import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatDateTime, formatRelative, truncate } from '../../lib/format';
import { Button, DeliverabilityBadge, StatusBadge } from '../../components/ui';
import type { ScheduledEmail } from '../../lib/types';

const CANCELLABLE = new Set(['PENDING', 'QUEUED']);

export default function EmailTable({ emails }: { emails: ScheduledEmail[] }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelEmail(id),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['email-stats'] });
      showToast('info', 'Email Cancelled', `Removed "${truncate(data.subject, 32)}" from active queue.`);
    },
    onError: (err) => {
      showToast('error', 'Cancellation Failed', err instanceof Error ? err.message : 'Could not cancel');
    },
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-white/[0.06] text-sm">
        <thead>
          <tr className="text-left text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            <th scope="col" className="px-6 py-3.5">Recipient</th>
            <th scope="col" className="px-6 py-3.5">Subject</th>
            <th scope="col" className="px-6 py-3.5">Scheduled For</th>
            <th scope="col" className="px-6 py-3.5">Sender</th>
            <th scope="col" className="px-6 py-3.5">Score</th>
            <th scope="col" className="px-6 py-3.5">Status</th>
            <th scope="col" className="px-6 py-3.5 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-white/[0.04]">
          {emails.map((email, index) => (
            <motion.tr
              key={email.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.025, 0.25) }}
              className="align-top transition-colors duration-150 hover:bg-white/[0.04]"
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="font-semibold text-slate-200">{email.to}</div>
                {email.cc && <div className="text-[11px] text-slate-500 font-mono">cc {email.cc}</div>}
                {email.followUpOfId && (
                  <span className="mt-1 inline-block rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/25">
                    thread follow-up
                  </span>
                )}
              </td>

              <td className="max-w-xs px-6 py-4">
                <div className="text-slate-200 font-medium">{truncate(email.subject, 64)}</div>
                {email.lastError && (
                  <div className="mt-1 text-xs text-red-400 font-mono" title={email.lastError}>
                    {truncate(email.lastError, 80)}
                  </div>
                )}
                {email.attempts > 1 && (
                  <div className="mt-1 text-[11px] text-slate-500">{email.attempts} attempts</div>
                )}
              </td>

              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-slate-300 font-medium">{formatDateTime(email.scheduledAt)}</div>
                <div className="text-xs text-slate-500">
                  {formatRelative(email.scheduledAt)}
                  {email.timezone && email.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
                    <span className="ml-1 text-slate-600">· {email.timezone}</span>
                  )}
                </div>
              </td>

              <td className="px-6 py-4 whitespace-nowrap">
                {email.mailbox ? (
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300">{email.mailbox.fromName}</span>
                    <span className="text-[11px] text-slate-500 font-mono" title={email.mailbox.fromEmail}>
                      {email.mailbox.fromEmail}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
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
                  <div className="mt-1 text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
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
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-violet-300 hover:text-white hover:bg-violet-500/20 border border-violet-500/30 transition-all duration-150 flex items-center gap-1 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                    >
                      <span>Preview</span>
                      <span className="text-[10px]">↗</span>
                    </a>
                  )}

                  {CANCELLABLE.has(email.status) && (
                    <Button
                      variant="danger"
                      className="px-2.5 py-1 text-xs"
                      loading={cancel.isPending && cancel.variables === email.id}
                      onClick={() => cancel.mutate(email.id)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
