import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button } from '../../components/ui';
import type { Mailbox } from '../../lib/types';

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
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['mailboxes'] }),
      showToast(
        'info',
        'Warmup Advanced',
        `${updated.fromName} advanced to Day ${updated.warmupDay} (Limit: ${updated.effectiveDailyLimit}/day)`,
      );
    },
  });

  if (isPending) {
    return (
      <aside className="elevation-2 p-5 rounded-2xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="skeleton-shimmer h-6 w-6 rounded-lg" />
          <div className="skeleton-shimmer h-4 w-32 rounded" />
        </div>
        <div className="space-y-4">
          <div className="skeleton-shimmer h-20 w-full rounded-xl" />
          <div className="skeleton-shimmer h-20 w-full rounded-xl" />
        </div>
      </aside>
    );
  }

  if (isError) {
    return (
      <aside className="elevation-2 p-5 rounded-2xl text-xs text-red-400 border border-red-500/20">
        Could not load sending mailboxes.
      </aside>
    );
  }

  return (
    <aside className="elevation-2 p-5 rounded-2xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.25)]">
            <svg className="h-3.5 w-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
            Sending Mailboxes
          </h2>
        </div>
        <span className="text-[10px] uppercase font-mono text-slate-500 font-semibold tracking-wider">
          Auto-Rotate
        </span>
      </div>

      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
        Outbound emails round-robin evenly with automated daily warmup limits.
      </p>

      {mailboxes.length === 0 ? (
        <p className="text-xs text-slate-500">
          No mailboxes found. Run <code className="font-mono text-violet-400">npm run seed</code> in backend.
        </p>
      ) : (
        <ul className="space-y-3">
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
    <li className="group relative rounded-xl elevation-1 p-3.5 transition-all duration-200 hover:border-white/20">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-200">{mailbox.fromName}</p>
          <p className="truncate text-[11px] text-slate-500 font-mono">{mailbox.fromEmail}</p>
        </div>
        <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-300 ring-1 ring-violet-500/30">
          day {mailbox.warmupDay}
        </span>
      </div>

      {/* Glass Capsule Progress Bar */}
      <div className="mt-3">
        <div
          className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06] p-[1px]"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${mailbox.fromEmail} daily quota`}
        >
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className={`h-full rounded-full ${
              atCap
                ? 'bg-gradient-to-r from-red-500 to-rose-400 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                : 'bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-400 shadow-[0_0_12px_rgba(139,92,246,0.4)]'
            }`}
          />
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <span className={`text-[11px] ${atCap ? 'text-red-400 font-medium' : 'text-slate-400'}`}>
            <span className="font-semibold text-slate-200">{used}</span> / {limit} sent ({pct}%)
            {atCap && ' · at cap'}
          </span>

          <Button
            variant="ghost"
            className="px-2 py-0.5 text-[10px] h-6"
            loading={advancing}
            onClick={onAdvance}
            title="Demo control: advance warmup day to increase daily limit"
          >
            Advance day
          </Button>
        </div>
      </div>
    </li>
  );
}
