import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Panel } from '../../components/ui';
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
    <Panel className="h-fit p-4">
      <h2 className="text-[13px] font-medium text-fg">Sending mailboxes</h2>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">
        New emails rotate across these round-robin. Each has a warmup-driven daily cap.
      </p>

      {isPending ? (
        <div className="mt-4 space-y-4" role="status" aria-label="Loading mailboxes">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3.5 w-32" />
              <div className="skeleton h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <p className="mt-4 text-xs text-danger" role="alert">
          Could not load mailboxes.
        </p>
      ) : mailboxes.length === 0 ? (
        <p className="mt-4 text-xs leading-relaxed text-fg-muted">
          No mailboxes yet — run <code className="font-mono">npm run seed</code> in the backend to
          create two.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
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
    </Panel>
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
    <li className="border-t border-line pt-4 first:border-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] text-fg" title={mailbox.fromEmail}>
          {mailbox.fromEmail}
        </p>
        <span className="tabular shrink-0 text-xs text-fg-muted">day {mailbox.warmupDay}</span>
      </div>

      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${mailbox.fromEmail} daily send allowance`}
      >
        <div
          className={`h-full transition-[width] duration-300 ${atCap ? 'bg-st-failed' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={`tabular text-xs ${atCap ? 'text-st-failed' : 'text-fg-muted'}`}>
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
