import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { CountUp } from '../../lib/motion';
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
    <section className="glass rounded-3xl" aria-labelledby="mailboxes-title">
      <div className="px-6 pt-5 pb-4">
        <h2 id="mailboxes-title" className="headline text-[1.45rem]">
          Sending mailboxes
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          New emails rotate across these round-robin, each under a warmup-driven daily cap.
        </p>
      </div>

      {isPending ? (
        <div className="space-y-5 px-6 pb-6" role="status" aria-label="Loading mailboxes">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2.5">
              <div className="skeleton h-3 w-36" />
              <div className="skeleton h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <p className="px-6 pb-6 text-xs text-danger" role="alert">
          Could not load mailboxes.
        </p>
      ) : mailboxes.length === 0 ? (
        <p className="px-6 pb-6 text-xs leading-relaxed text-ink-3">
          No mailboxes yet — emails go out from the default sender. Run{' '}
          <code className="mono text-ink-2">npm run seed</code> in the backend to create two.
        </p>
      ) : (
        <ul className="space-y-2.5 px-3 pb-3">
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
    </section>
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
    <li className="rounded-2xl border border-edge bg-black/20 px-4 py-4 transition-colors hover:border-edge-strong">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-ink" title={mailbox.fromEmail}>
          {mailbox.fromEmail}
        </p>
        <span className="mono shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-ink-2">
          DAY {mailbox.warmupDay}
        </span>
      </div>

      <div
        className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${mailbox.fromEmail} daily send allowance`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${
            atCap ? 'bg-gradient-to-r from-rose-400 to-ember' : 'bg-gradient-to-r from-amber to-plum'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className={`mono text-xs ${atCap ? 'text-st-failed' : 'text-ink-3'}`}>
          <CountUp value={used} duration={0.8} />/{limit} today
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
