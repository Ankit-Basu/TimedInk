import { useState, useEffect, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, EmptyState, ErrorState, LoadingState } from '../components/ui';
import EmailTable from '../features/emails/EmailTable';
import ComposeModal from '../features/emails/ComposeModal';
import MailboxPanel from '../features/mailboxes/MailboxPanel';
import MoltenMetal from '../components/MoltenMetal';
import TimedInkLogo from '../components/TimedInkLogo';
import type { EmailStatus } from '../lib/types';

const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 4000);
const PAGE_SIZE = 20;

interface Tab {
  id: string;
  label: string;
  statuses: EmailStatus[];
  icon: string;
  empty: { title: string; description: string };
}

const TABS: Tab[] = [
  {
    id: 'scheduled',
    label: 'Scheduled',
    icon: '⏳',
    statuses: ['PENDING', 'QUEUED', 'SENDING'],
    empty: {
      title: 'Nothing scheduled',
      description: 'Emails you schedule will appear here until the worker sends them.',
    },
  },
  {
    id: 'sent',
    label: 'Sent',
    icon: '✓',
    statuses: ['SENT'],
    empty: {
      title: 'Nothing sent yet',
      description: 'Once an email goes out it lands here with a live preview link.',
    },
  },
  {
    id: 'failed',
    label: 'Failed',
    icon: '✕',
    statuses: ['FAILED'],
    empty: {
      title: 'No failures',
      description: 'Emails land here after BullMQ exhausts its retries, or when a missed window is flagged.',
    },
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    icon: '⊘',
    statuses: ['CANCELLED'],
    empty: {
      title: 'Nothing cancelled',
      description: 'Cancelling a scheduled email removes its queued job and files it here.',
    },
  },
];

/** Smooth number counting up on mount/refresh */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    prevRef.current = value;
    if (start === end) return;

    const startTime = performance.now();
    const duration = 650;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * ease));
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }, [value]);

  return <span>{display}</span>;
}

interface StatCardProps {
  label: string;
  value: number;
  variant: 'purple' | 'emerald' | 'red' | 'amber';
  trend: string;
  delay?: number;
}

function StatCard({ label, value, variant, trend, delay = 0 }: StatCardProps) {
  const variantClass = {
    purple: 'ambient-purple text-violet-300',
    emerald: 'ambient-emerald text-emerald-300',
    red: 'ambient-red text-red-300',
    amber: 'ambient-amber text-amber-300',
  }[variant];

  const trendColors = {
    purple: 'text-violet-400/80',
    emerald: 'text-emerald-400/80',
    red: 'text-red-400/80',
    amber: 'text-amber-400/80',
  }[variant];

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`ambient-card ${variantClass} p-4`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <span className={`text-[10px] font-medium ${trendColors} flex items-center gap-1`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-75" />
          {trend}
        </span>
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <p className="text-3xl font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-heading)' }}>
          <AnimatedNumber value={value} />
        </p>
      </div>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [activeTabId, setActiveTabId] = useState(TABS[0]!.id);
  const [page, setPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);

  // Live countdown to next poll
  const [secondsUntilPoll, setSecondsUntilPoll] = useState(Math.round(POLL_INTERVAL_MS / 1000));

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

  // Countdown timer effect
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilPoll((prev) => (prev <= 1 ? Math.round(POLL_INTERVAL_MS / 1000) : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Reset timer on query refetch
  useEffect(() => {
    if (emailsQuery.isFetching) {
      setSecondsUntilPoll(Math.round(POLL_INTERVAL_MS / 1000));
    }
  }, [emailsQuery.isFetching]);

  const countFor = (tab: Tab): number =>
    statsQuery.data ? tab.statuses.reduce((sum, s) => sum + (statsQuery.data.counts[s] ?? 0), 0) : 0;

  const scheduledCount = countFor(TABS[0]!);
  const sentCount = countFor(TABS[1]!);
  const failedCount = countFor(TABS[2]!);
  const cancelledCount = countFor(TABS[3]!);

  const pagination = emailsQuery.data?.pagination;

  return (
    <div className="relative min-h-full selection:bg-violet-500/30">
      {/* MoltenMetal WebGL Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <MoltenMetal
          color1="#5227FF"
          color2="#FF9FFC"
          color3="#FFFFFF"
          speed={0.18}
          scale={4.5}
          detail={2}
          glow={1.1}
          coreSize={0.08}
          swirl={0.7}
          fold={-0.12}
          blackPoint={0.12}
          brightness={0.75}
          colorMode="molten"
          grain
          grainIntensity={0.03}
          mouseInteraction={false}
          opacity={0.22}
        />
      </div>

      {/* Sticky Header with Hairline Gradient Edge */}
      <header className="sticky top-0 z-30 hairline-gradient-bottom bg-black/40 backdrop-blur-xl transition-all">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <TimedInkLogo size={32} showWordmark={true} />

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-400 sm:inline px-3 py-1 rounded-full elevation-1">
              {user?.email}
            </span>
            <Button onClick={() => setComposeOpen(true)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New email
            </Button>
            <Button variant="ghost" onClick={logout} className="text-xs">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Stat cards in tight ambient grid */}
        <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatCard
            label="Scheduled"
            value={scheduledCount}
            variant="purple"
            trend={scheduledCount > 0 ? `${scheduledCount} in queue` : 'queue clear'}
            delay={0}
          />
          <StatCard
            label="Sent"
            value={sentCount}
            variant="emerald"
            trend={`${sentCount} delivered`}
            delay={0.04}
          />
          <StatCard
            label="Failed"
            value={failedCount}
            variant="red"
            trend={failedCount === 0 ? 'zero errors' : `${failedCount} flagged`}
            delay={0.08}
          />
          <StatCard
            label="Cancelled"
            value={cancelledCount}
            variant="amber"
            trend={`${cancelledCount} retracted`}
            delay={0.12}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Main Table Column */}
          <section className="min-w-0">
            <div className="elevation-2 overflow-hidden">
              {/* Tab Navigation with Framer Motion Sliding Pill */}
              <nav className="flex items-center gap-1 border-b border-white/[0.06] p-2" aria-label="Email status">
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
                      className={`relative px-4 py-2 text-sm font-medium rounded-xl transition-colors duration-150 flex items-center gap-2 ${
                        active ? 'text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {/* Sliding active pill indicator */}
                      {active && (
                        <motion.div
                          layoutId="active-tab-pill"
                          className="absolute inset-0 rounded-xl bg-white/[0.09] border border-white/15 shadow-[0_0_16px_rgba(139,92,246,0.2)]"
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10 text-xs">{tab.icon}</span>
                      <span className="relative z-10">{tab.label}</span>
                      <span
                        className={`relative z-10 rounded-full px-2 py-0.5 text-[10px] font-bold transition-all ${
                          active
                            ? 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/40'
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

            {/* Live Auto-Refresh Indicator with pulsing dot & countdown */}
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 select-none">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>
                Live sync in <span className="font-mono text-slate-400 font-semibold">{secondsUntilPoll}s</span>
              </span>
            </div>
          </section>

          {/* Mailbox Sidebar Panel */}
          <div>
            <MailboxPanel pollIntervalMs={POLL_INTERVAL_MS} />
          </div>
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
