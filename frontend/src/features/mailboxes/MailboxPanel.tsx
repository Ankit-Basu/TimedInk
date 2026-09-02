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
      <aside className="glass-panel elevation-3 p-5">
        <div className="flex items-center gap-2 mb-4">
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
      <aside className="elevation-3 p-5 text-xs text-[var(--status-failed)]">
        Could not load sending mailboxes.
      </aside>
    );
  }

  return (
    <aside className="glass-panel elevation-3 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
          Sending Mailboxes
        </h2>
        <span className="rounded-full border border-[var(--color-aqua)]/25 bg-[var(--color-aqua)]/10 px-2.5 py-1 text-[10px] uppercase font-mono text-[var(--color-aqua)] font-semibold tracking-wider">
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
          {mailboxes.map((mailbox, i) => (
            <motion.li
              key={mailbox.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06 }}
            >
              <MailboxRow
                mailbox={mailbox}
                onAdvance={() => advance.mutate(mailbox.id)}
                advancing={advance.isPending && advance.variables === mailbox.id}
              />
            </motion.li>
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
    <div className="group sheen-hover relative rounded-xl elevation-1 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/25">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-200">{mailbox.fromName}</p>
          <p className="truncate text-[11px] text-slate-500 font-mono">{mailbox.fromEmail}</p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-gold)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-gold)] ring-1 ring-[var(--color-gold)]/25">
          day {mailbox.warmupDay}
        </span>
      </div>

      <div className="mt-3">
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-black/25 p-[1px] ring-1 ring-white/10"
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
                ? 'bg-[var(--status-failed)]'
                : 'bg-gradient-to-r from-[#9f7aea] via-[#55d6be] to-[#f6c76b]'
            }`}
          />
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <span className={`text-[11px] ${atCap ? 'text-[var(--status-failed)] font-medium' : 'text-slate-400'}`}>
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
    </div>
  );
}
