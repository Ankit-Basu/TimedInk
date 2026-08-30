import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, EmptyState, ErrorState, LoadingState } from '../components/ui';
import EmailTable from '../features/emails/EmailTable';
import ComposeModal from '../features/emails/ComposeModal';
import MailboxPanel from '../features/mailboxes/MailboxPanel';
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
      description:
        'Once an email goes out it lands here with a link to its Ethereal preview.',
    },
  },
  {
    id: 'failed',
    label: 'Failed',
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
    statuses: ['CANCELLED'],
    empty: {
      title: 'Nothing cancelled',
      description: 'Cancelling a scheduled email removes its queued job and files it here.',
    },
  },
];

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
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              OP
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Outbox Pilot</p>
              <p className="text-xs text-slate-500">
                {statsQuery.data ? `${statsQuery.data.total} emails` : '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{user?.email}</span>
            <Button onClick={() => setComposeOpen(true)}>New email</Button>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <section className="min-w-0">
            <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <nav className="flex gap-1 border-b border-slate-200 px-3 pt-3" aria-label="Email status">
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
                      className={`rounded-t-md px-3 py-2 text-sm font-medium transition ${
                        active
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                      <span
                        className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] ${
                          active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
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
                    <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-sm">
                      <span className="text-slate-500">
                        Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          className="px-2 py-1 text-xs"
                          disabled={pagination.page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-2 py-1 text-xs"
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

            <p className="mt-3 text-xs text-slate-400">
              Auto-refreshing every {Math.round(POLL_INTERVAL_MS / 1000)}s.
            </p>
          </section>

          <MailboxPanel pollIntervalMs={POLL_INTERVAL_MS} />
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
