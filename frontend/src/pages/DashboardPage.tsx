import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, EmptyState, ErrorState, LoadingState } from '../components/ui';
import EmailTable from '../features/emails/EmailTable';
import ComposeModal from '../features/emails/ComposeModal';
import MailboxPanel from '../features/mailboxes/MailboxPanel';
import Particles from '../components/Particles';
import SpotlightCard from '../components/SpotlightCard';
import CountUp from '../components/CountUp';
import TimedInkLogo from '../components/TimedInkLogo';
import type { EmailStatus } from '../lib/types';

const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 4000);
const PAGE_SIZE = 20;

interface Tab {
  id: string;
  label: string;
  statuses: EmailStatus[];
  empty: { title: string; description: string };
}

const TABS: Tab[] = [
  {
    id: 'scheduled',
    label: 'Scheduled',
    statuses: ['PENDING', 'QUEUED', 'SENDING'],
    empty: {
      title: 'Nothing scheduled',
      description: 'Emails you schedule will appear here until the worker sends them.',
    },
  },
  {
    id: 'sent',
    label: 'Sent',
    statuses: ['SENT'],
    empty: {
      title: 'Nothing sent yet',
      description: 'Once an email goes out it lands here with a live preview link.',
    },
  },
  {
    id: 'failed',
    label: 'Failed',
    statuses: ['FAILED'],
    empty: {
      title: 'No failures',
      description: 'Emails land here after BullMQ exhausts its retries, or when a missed window is flagged.',
    },
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    statuses: ['CANCELLED'],
    empty: {
      title: 'Nothing cancelled',
      description: 'Cancelling a scheduled email removes its queued job and files it here.',
    },
  },
];

/* Stat card spotlight colors — one per variant */
const SPOTLIGHT_COLORS: Record<string, string> = {
  scheduled: 'rgba(159, 122, 234, 0.24)',
  sent: 'rgba(85, 214, 190, 0.24)',
  failed: 'rgba(255, 122, 122, 0.2)',
  cancelled: 'rgba(246, 199, 107, 0.16)',
};

const STAT_TEXT_COLORS: Record<string, string> = {
  scheduled: 'text-[#bba4ff]',
  sent: 'text-[var(--status-sent)]',
  failed: 'text-[var(--status-failed)]',
  cancelled: 'text-[var(--status-cancelled)]',
};

const STAT_ACCENTS: Record<string, string> = {
  scheduled: 'from-[#9f7aea] to-[#55d6be]',
  sent: 'from-[#55d6be] to-[#f6c76b]',
  failed: 'from-[#ff7a7a] to-[#f6c76b]',
  cancelled: 'from-[#aeb6c8] to-[#9f7aea]',
};

/* High-visibility vibrant particle colors for glowing contrast */
const DASHBOARD_PARTICLE_COLORS = [
  '#ffffff',
  '#f5d0fe',
  '#c084fc',
  '#a855f7',
  '#818cf8',
  '#38bdf8',
  '#e879f9',
];

/** Isolated countdown component so the entire Dashboard doesn't re-render every second */
function LiveSyncIndicator({ pollIntervalMs, isFetching }: { pollIntervalMs: number; isFetching: boolean }) {
  const [seconds, setSeconds] = useState(Math.round(pollIntervalMs / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => (prev <= 1 ? Math.round(pollIntervalMs / 1000) : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [pollIntervalMs]);

  useEffect(() => {
    if (isFetching) {
      setSeconds(Math.round(pollIntervalMs / 1000));
    }
  }, [isFetching, pollIntervalMs]);

  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 select-none">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--status-sent)] opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--status-sent)]" />
      </span>
      <span>
        Live sync in <span className="font-mono text-slate-300 font-semibold">{seconds}s</span>
      </span>
    </div>
  );
}

function TabGlyph({ id, active }: { id: string; active: boolean }) {
  const common = active ? 'text-white' : 'text-slate-400';
  if (id === 'scheduled') {
    return (
      <svg className={`h-3.5 w-3.5 ${common}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 5.8v4.5l3 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === 'sent') {
    return (
      <svg className={`h-3.5 w-3.5 ${common}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 10.5l3.7 3.7L16 5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === 'failed') {
    return (
      <svg className={`h-3.5 w-3.5 ${common}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className={`h-3.5 w-3.5 ${common}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 14L14 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [activeTabId, setActiveTabId] = useState(TABS[0]!.id);
  const [page, setPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);

  const activeTab = TABS.find((t) => t.id === activeTabId) ?? TABS[0]!;

  const emailsQuery = useQuery({
    queryKey: ['emails', activeTab.id, page],
    queryFn: () => api.listEmails({ status: activeTab.statuses, page, pageSize: PAGE_SIZE }),
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });

  const statsQuery = useQuery({
    queryKey: ['email-stats'],
    queryFn: () => api.emailStats(),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const countFor = (tab: Tab): number =>
    statsQuery.data ? tab.statuses.reduce((sum, s) => sum + (statsQuery.data.counts[s] ?? 0), 0) : 0;

  const scheduledCount = countFor(TABS[0]!);
  const sentCount = countFor(TABS[1]!);
  const failedCount = countFor(TABS[2]!);
  const cancelledCount = countFor(TABS[3]!);

  const stats = [
    { id: 'scheduled', label: 'Scheduled', value: scheduledCount, trend: scheduledCount > 0 ? `${scheduledCount} in queue` : 'queue clear' },
    { id: 'sent', label: 'Sent', value: sentCount, trend: `${sentCount} delivered` },
    { id: 'failed', label: 'Failed', value: failedCount, trend: failedCount === 0 ? 'zero errors' : `${failedCount} flagged` },
    { id: 'cancelled', label: 'Cancelled', value: cancelledCount, trend: `${cancelledCount} retracted` },
  ];

  const pagination = emailsQuery.data?.pagination;

  return (
    <div className="immersive-bg relative min-h-full selection:bg-violet-500/30">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Particles
          particleColors={DASHBOARD_PARTICLE_COLORS}
          particleCount={140}
          particleSpread={10}
          speed={0.045}
          particleBaseSize={105}
          moveParticlesOnHover={false}
          disableRotation
          sizeRandomness={0.55}
          cameraDistance={18}
          pixelRatio={1}
          fpsLimit={30}
          className="opacity-55"
        />
      </div>

      <header className="top-nav-wrap sticky top-0 z-30 px-3 py-3 sm:px-5">
        <div className="top-nav-shell relative mx-auto flex max-w-7xl items-center justify-between gap-3 rounded-2xl px-3 py-2.5 sm:px-4">
          <TimedInkLogo size={34} showWordmark={true} />

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="nav-user-pill hidden max-w-[16rem] truncate rounded-full px-3 py-1.5 text-xs text-slate-300 md:inline">
              {user?.email}
            </span>
            <Button onClick={() => setComposeOpen(true)} className="shrink-0">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="hidden sm:inline">New email</span>
              <span className="sm:hidden">New</span>
            </Button>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="nav-icon-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            >
              <svg className="h-4.5 w-4.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M8 5.5V4.25A1.75 1.75 0 019.75 2.5h5A1.75 1.75 0 0116.5 4.25v11.5a1.75 1.75 0 01-1.75 1.75h-5A1.75 1.75 0 018 15.75V14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M11.5 10h-8M6.5 7l-3 3 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <section className="mb-6 flex flex-col justify-between gap-5 rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-md sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-aqua)]">Mission Control</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl" style={{ fontFamily: 'var(--font-heading)' }}>
              Outbound cockpit
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Schedule, rotate, track, retry, and inspect every precision email from one live glass surface.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-slate-400">{PAGE_SIZE}</p>
              <p className="text-slate-500">per page</p>
            </div>
            <div className="rounded-xl border border-[var(--color-aqua)]/20 bg-[var(--color-aqua)]/10 px-3 py-2">
              <p className="font-mono text-[var(--color-aqua)]">{Math.round(POLL_INTERVAL_MS / 1000)}s</p>
              <p className="text-slate-500">refresh</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-slate-300">UTC</p>
              <p className="text-slate-500">safe</p>
            </div>
          </div>
        </section>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
            >
              <SpotlightCard
                spotlightColor={SPOTLIGHT_COLORS[stat.id]}
                className={stat.id === 'scheduled' ? 'border-violet-500/20' : ''}
              >
                <div className="sheen-hover p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{stat.label}</p>
                    <span className={`text-[10px] font-medium ${STAT_TEXT_COLORS[stat.id]} opacity-70 flex items-center gap-1`}>
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-75" />
                      {stat.trend}
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="text-3xl font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-heading)' }}>
                      <CountUp from={0} to={stat.value} duration={0.55} separator="," />
                    </p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, Math.max(10, stat.value * 8))}%` }}
                        transition={{ duration: 1, delay: i * 0.08 }}
                        className={`h-full rounded-full bg-gradient-to-r ${STAT_ACCENTS[stat.id]}`}
                      />
                    </div>
                  </div>
                </div>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Main Table Column */}
          <section className="min-w-0">
            <div className="glass-panel elevation-2 overflow-hidden">
              <nav className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.08] p-2" aria-label="Email status">
                {TABS.map((tab) => {
                  const active = tab.id === activeTab.id;
                  const count = countFor(tab);
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        setActiveTabId(tab.id);
                        setPage(1);
                      }}
                      className={`relative shrink-0 px-4 py-2 text-sm font-medium rounded-xl transition-colors duration-150 flex items-center gap-2 ${
                        active ? 'text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {active && (
                        <motion.div
                          layoutId="active-tab-pill"
                          className="absolute inset-0 rounded-xl border border-white/[0.16] bg-white/[0.1] shadow-[0_0_24px_rgba(85,214,190,0.1)]"
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10">
                        <TabGlyph id={tab.id} active={active} />
                      </span>
                      <span className="relative z-10">{tab.label}</span>
                      <span
                        className={`relative z-10 rounded-full px-2 py-0.5 text-[10px] font-bold transition-all ${
                          active
                            ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/35'
                            : 'bg-white/[0.06] text-slate-500'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </nav>

              {emailsQuery.isPending ? (
                <LoadingState label="Loading emails…" />
              ) : emailsQuery.isError ? (
                <ErrorState error={emailsQuery.error} onRetry={() => void emailsQuery.refetch()} />
              ) : emailsQuery.data.data.length === 0 ? (
                <EmptyState
                  title={activeTab.empty.title}
                  description={activeTab.empty.description}
                  action={
                    activeTab.id === 'scheduled' ? (
                      <Button onClick={() => setComposeOpen(true)}>Schedule your first email</Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeTab.id + page}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                    >
                      <EmailTable emails={emailsQuery.data.data} />
                    </motion.div>
                  </AnimatePresence>

                  {pagination && pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-3 text-xs">
                      <span className="text-slate-400">
                        Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          className="px-3 py-1 text-xs"
                          disabled={pagination.page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-3 py-1 text-xs"
                          disabled={pagination.page >= pagination.totalPages}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Live Auto-Refresh Indicator */}
            <LiveSyncIndicator
              pollIntervalMs={POLL_INTERVAL_MS}
              isFetching={emailsQuery.isFetching}
            />
          </section>

          {/* Mailbox Sidebar */}
          <div>
            <MailboxPanel pollIntervalMs={POLL_INTERVAL_MS} />
          </div>
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
