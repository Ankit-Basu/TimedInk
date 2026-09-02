import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button } from '../../components/ui';
import type { Mailbox } from '../../lib/types';

/**
 * Bonus B/C surface: the mailboxes a user sends from, their warmup position,
 * and how much of today's allowance is already spent.
 *
 * "Advance day" exists purely so the ramp is demonstrable — warmup normally
 * moves one day per real day, which is unwatchable in a short demo.
 */
export default function MailboxPanel({ pollIntervalMs }: { pollIntervalMs: number }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: mailboxes, isPending, isError } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => api.listMailboxes(),
    refetchInterval: pollIntervalMs,
  });

  const advance = useMutation({
    mutationFn: (id: string) => api.advanceWarmup(id, 1),
    onSuccess: (mailbox) => {
      void queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      showToast(
        'success',
        'Warmup advanced',
        `${mailbox.fromEmail} is on day ${mailbox.warmupDay} — ${mailbox.effectiveDailyLimit}/day.`,
      );
    },
    onError: () => showToast('error', 'Could not advance warmup'),
  });

  return (
    <aside>
      <div className="border-b border-rule px-6 py-4">
        <h2 className="label">Sending mailboxes</h2>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          New emails rotate across these round-robin. Each has a warmup-driven daily cap.
        </p>
      </div>

      {isPending ? (
        <div className="space-y-5 px-6 py-5" role="status" aria-label="Loading mailboxes">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2.5">
              <div className="skeleton h-3 w-36" />
              <div className="skeleton h-px w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <p className="px-6 py-5 text-xs text-danger" role="alert">
          Could not load mailboxes.
        </p>
      ) : mailboxes.length === 0 ? (
        <p className="px-6 py-5 text-xs leading-relaxed text-ink-3">
          No mailboxes yet — run <code className="mono text-ink-2">npm run seed</code> in the
          backend to create two.
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {mailboxes.map((mailbox) => (
            <MailboxRow
              key={mailbox.id}
              mailbox={mailbox}
              onAdvance={() => advance.mutate(mailbox.id)}
              advancing={advance.isPending && advance.variables === mailbox.id}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

function MailboxRow({
  mailbox,
  onAdvance,
  advancing,
}: {
  mailbox: Mailbox;
  onAdvance: () => void;
  advancing: boolean;
}) {
  const limit = mailbox.effectiveDailyLimit;
  const used = Math.min(mailbox.usedToday, limit);
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const atCap = used >= limit;

  return (
    <li className="px-6 py-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] text-ink" title={mailbox.fromEmail}>
          {mailbox.fromEmail}
        </p>
        <span className="label shrink-0">Day {mailbox.warmupDay}</span>
      </div>

      {/* A rule that fills, rather than a pill — same language as the score bar. */}
      <div
        className="mt-3.5 h-px w-full bg-rule"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${mailbox.fromEmail} daily send allowance`}
      >
        <div
          className={`h-px transition-[width] duration-500 ${atCap ? 'bg-st-failed' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className={`mono text-xs ${atCap ? 'text-st-failed' : 'text-ink-3'}`}>
          {used}/{limit} today
          {atCap && ' · at cap'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          loading={advancing}
          onClick={onAdvance}
          title="Demo control: bump warmupDay by one so the daily cap rises"
        >
          Advance day
        </Button>
      </div>
    </li>
  );
}
