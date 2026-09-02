import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button, Spinner } from '../../components/ui';
import type { Mailbox } from '../../lib/types';

/**
 * Bonus B/C surface: the mailboxes a user sends from, their warmup position,
 * and how much of today's allowance is already spent.
 *
 * "Advance warmup day" exists purely so the ramp is demonstrable — warmup
 * normally moves one day per real day, which is unwatchable in a short demo.
 */
export default function MailboxPanel({ pollIntervalMs }: { pollIntervalMs: number }) {
  const queryClient = useQueryClient();

  const { data: mailboxes, isPending, isError } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => api.listMailboxes(),
    refetchInterval: pollIntervalMs,
  });

  const advance = useMutation({
    mutationFn: (id: string) => api.advanceWarmup(id, 1),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['mailboxes'] }),
  });

  if (isPending) {
    return (
      <aside className="glass-panel p-5">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner className="h-4 w-4 text-violet-400" /> Loading mailboxes…
        </div>
      </aside>
    );
  }

  if (isError) {
    return (
      <aside className="glass-panel p-5 text-sm text-red-400">
        Could not load mailboxes.
      </aside>
    );
  }

  return (
    <aside className="glass-panel p-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25">
          <svg className="h-3.5 w-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <h2 className="text-sm font-bold text-white" style={{ fontFamily: 'var(--font-heading)' }}>Sending mailboxes</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        New emails rotate across these round-robin. Each has a warmup-driven daily cap.
      </p>

      {mailboxes.length === 0 ? (
        <p className="text-sm text-slate-500">
          No mailboxes yet — run <code className="font-mono text-xs text-violet-400">npm run seed</code> in the
          backend to create two.
        </p>
      ) : (
        <ul className="space-y-4">
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
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const atCap = used >= limit;

  return (
    <li className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-200">{mailbox.fromName}</p>
          <p className="truncate text-xs text-slate-500">{mailbox.fromEmail}</p>
        </div>
        <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-300 ring-1 ring-violet-500/25">
          day {mailbox.warmupDay}
        </span>
      </div>

      <div className="mt-3">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${mailbox.fromEmail} daily usage`}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              atCap
                ? 'bg-gradient-to-r from-red-500 to-red-400'
                : 'bg-gradient-to-r from-violet-500 to-fuchsia-400'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className={`text-xs ${atCap ? 'text-red-400' : 'text-slate-500'}`}>
            {used} / {limit} sent today
            {atCap && ' — at cap, new jobs re-delay'}
          </span>
          <Button
            variant="ghost"
            className="px-2 py-1 text-[11px]"
            loading={advancing}
            onClick={onAdvance}
            title="Demo control: bump warmupDay by one so the daily cap rises"
          >
            Advance day
          </Button>
        </div>
      </div>
    </li>
  );
}
