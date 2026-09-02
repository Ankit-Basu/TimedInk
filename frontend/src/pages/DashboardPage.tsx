import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, EmptyState, ErrorState, LoadingState } from '../components/ui';
import EmailTable from '../features/emails/EmailTable';
import ComposeModal from '../features/emails/ComposeModal';
import MailboxPanel from '../features/mailboxes/MailboxPanel';
import MoltenMetal from '../components/MoltenMetal';
import type { EmailStatus } from '../lib/types';

/**
 * Poll interval for the dashboard.
 *
 * NOTE: polling is the right call at this size — one user, a handful of rows,
 * and it survives an API restart with no reconnect logic. In a larger system
 * this would be a WebSocket or SSE subscription pushing status transitions
 * (the worker already emits an EmailEvent per transition, which is exactly the
 * stream you would publish), so the client would not re-query on a timer.
 */
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
      description:
        'Once an email goes out it lands here with a link to its Ethereal preview.',
    },
  },
  {
    id: 'failed',
    label: 'Failed',
    icon: '✕',
    statuses: ['FAILED'],
    empty: {
      title: 'No failures',
      description:
        'Emails land here after BullMQ exhausts its retries, or when a missed send window is flagged for review.',
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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorStyles: Record<string, string> = {
    purple: 'from-violet-500/20 to-violet-600/5 ring-violet-500/20 text-violet-300',
    emerald: 'from-emerald-500/20 to-emerald-600/5 ring-emerald-500/20 text-emerald-300',
    red: 'from-red-500/20 to-red-600/5 ring-red-500/20 text-red-300',
    amber: 'from-amber-500/20 to-amber-600/5 ring-amber-500/20 text-amber-300',
  };
  return (
    <div className={`rounded-xl bg-gradient-to-br ${colorStyles[color]} p-4 ring-1 backdrop-blur-sm`}>
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>
        {value}
      </p>
    </div>
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
    // Keep the previous page on screen while the next one loads, so the table
    // does not flash empty on every poll.
    placeholderData: keepPreviousData,
  });

  const statsQuery = useQuery({
    queryKey: ['email-stats'],
    queryFn: () => api.emailStats(),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const countFor = (tab: Tab): number =>
    statsQuery.data ? tab.statuses.reduce((sum, s) => sum + (statsQuery.data.counts[s] ?? 0), 0) : 0;

  const pagination = emailsQuery.data?.pagination;

  return (
    <div className="relative min-h-full">
      {/* MoltenMetal background — dimmed for readability */}
      <div className="fixed inset-0 z-0">
        <MoltenMetal
          color1="#5227FF"
          color2="#FF9FFC"
          color3="#FFFFFF"
          speed={0.2}
          scale={5}
          detail={2}
          glow={1.2}
          coreSize={0.08}
          swirl={0.8}
          fold={-0.15}
          blackPoint={0.1}
          brightness={0.8}
          colorMode="molten"
          grain
          grainIntensity={0.03}
          mouseInteraction={false}
          opacity={0.25}
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 shadow-[0_0_20px_rgba(139,92,246,0.3)]">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-white" style={{ fontFamily: 'var(--font-heading)' }}>TimedInk</p>
              <p className="text-xs text-slate-500">
                {statsQuery.data ? `${statsQuery.data.total} emails` : '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-400 sm:inline">{user?.email}</span>
            <Button onClick={() => setComposeOpen(true)}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New email
            </Button>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Stat cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-in">
          <StatCard label="Scheduled" value={countFor(TABS[0]!)} color="purple" />
          <StatCard label="Sent" value={countFor(TABS[1]!)} color="emerald" />
          <StatCard label="Failed" value={countFor(TABS[2]!)} color="red" />
          <StatCard label="Cancelled" value={countFor(TABS[3]!)} color="amber" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <section className="min-w-0 animate-fade-in" style={{ animationDelay: '100ms' }}>
            <div className="glass-panel overflow-hidden">
              {/* Tab nav */}
              <nav className="flex gap-1 border-b border-white/[0.06] px-4 pt-3" aria-label="Email status">
                {TABS.map((tab) => {
                  const active = tab.id === activeTab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        setActiveTabId(tab.id);
                        setPage(1);
                      }}
                      className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        active
                          ? 'bg-white/[0.08] text-white border-b-2 border-violet-500'
                          : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
                      }`}
                    >
                      <span className="mr-1.5">{tab.icon}</span>
                      {tab.label}
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active
                            ? 'bg-violet-500/20 text-violet-300'
                            : 'bg-white/[0.06] text-slate-500'
                        }`}
                      >
                        {countFor(tab)}
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
                  <EmailTable emails={emailsQuery.data.data} />

                  {pagination && pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-3 text-sm">
                      <span className="text-slate-500">
                        Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          disabled={pagination.page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
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

            <p className="mt-3 text-xs text-slate-600">
              Auto-refreshing every {Math.round(POLL_INTERVAL_MS / 1000)}s.
            </p>
          </section>

          <div className="animate-fade-in" style={{ animationDelay: '200ms' }}>
            <MailboxPanel pollIntervalMs={POLL_INTERVAL_MS} />
          </div>
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
