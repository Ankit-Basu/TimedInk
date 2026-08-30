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
      <aside className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4 text-indigo-600" /> Loading mailboxes…
        </div>
      </aside>
    );
  }

  if (isError) {
    return (
      <aside className="rounded-xl bg-white p-5 text-sm text-red-600 shadow-sm ring-1 ring-slate-200">
        Could not load mailboxes.
      </aside>
    );
  }

  return (
    <aside className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">Sending mailboxes</h2>
      <p className="mt-1 text-xs text-slate-500">
        New emails rotate across these round-robin. Each has a warmup-driven daily cap.
      </p>

      {mailboxes.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No mailboxes yet — run <code className="font-mono text-xs">npm run seed</code> in the
          backend to create two.
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
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{mailbox.fromName}</p>
          <p className="truncate text-xs text-slate-500">{mailbox.fromEmail}</p>
        </div>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
          day {mailbox.warmupDay}
        </span>
      </div>

      <div className="mt-2">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${mailbox.fromEmail} daily usage`}
        >
          <div
            className={`h-full rounded-full transition-all ${atCap ? 'bg-red-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className={`text-xs ${atCap ? 'text-red-600' : 'text-slate-500'}`}>
            {used} / {limit} sent today
            {atCap && ' — at cap, new jobs re-delay'}
          </span>
          <Button
            variant="ghost"
            className="px-1.5 py-0.5 text-[11px]"
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
