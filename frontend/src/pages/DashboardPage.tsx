import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, EmptyState, ErrorState, LoadingState, Panel } from '../components/ui';
import EmailTable from '../features/emails/EmailTable';
import ComposeModal from '../features/emails/ComposeModal';
import MailboxPanel from '../features/mailboxes/MailboxPanel';
import Logo from '../components/Logo';
import type { EmailStatus } from '../lib/types';

/**
 * How often the dashboard re-reads the list and the counts.
 *
 * NOTE: this is polling, which is the right call at this size — one operator,
 * a few hundred rows, and it recovers from an API restart with no reconnect
 * logic. In a larger system this would be a WebSocket or SSE subscription
 * pushing status transitions instead: the worker already writes an EmailEvent
 * on every transition, which is exactly the stream you would publish, and the
 * client would then render on push rather than re-querying on a timer.
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
      description: 'Once an email goes out it lands here with a link to its Ethereal preview.',
    },
  },
  {
    id: 'failed',
    label: 'Failed',
    statuses: ['FAILED'],
    empty: {
      title: 'No failures',
      description:
        'Emails land here after the queue exhausts its retries, or when a missed send window is flagged for review.',
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
    // Keep the current page on screen while the next loads, so the table does
    // not blank out on every poll.
    placeholderData: keepPreviousData,
  });

  const statsQuery = useQuery({
    queryKey: ['email-stats'],
    queryFn: () => api.emailStats(),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const countFor = useCallback(
    (tab: Tab): number | null =>
      statsQuery.data
        ? tab.statuses.reduce((sum, s) => sum + (statsQuery.data.counts[s] ?? 0), 0)
        : null,
    [statsQuery.data],
  );

  // `c` opens the composer, Escape closes it. Cheap, and the kind of thing an
  // operator who lives in this screen all day will use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      setComposeOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pagination = emailsQuery.data?.pagination;
  const rows = emailsQuery.data?.data ?? [];

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />

          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-fg-muted sm:inline">{user?.email}</span>
            <Button onClick={() => setComposeOpen(true)}>
              New email
              <kbd className="ml-0.5 hidden rounded border border-white/25 px-1 text-[10px] font-normal text-white/70 sm:inline">
                c
              </kbd>
            </Button>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-w-0">
            <Panel className="overflow-hidden">
              <nav
                className="flex items-center gap-1 overflow-x-auto border-b border-line px-2"
                aria-label="Filter by status"
              >
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
                      className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13px] transition-colors ${
                        active
                          ? 'border-accent font-medium text-fg'
                          : 'border-transparent text-fg-secondary hover:text-fg'
                      }`}
                    >
                      {tab.label}
                      <span
                        className={`tabular ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                          active ? 'bg-accent-quiet text-accent' : 'bg-surface-2 text-fg-muted'
                        }`}
                      >
                        {count ?? '–'}
                      </span>
                    </button>
                  );
                })}
              </nav>

              {emailsQuery.isPending ? (
                <LoadingState />
              ) : emailsQuery.isError ? (
                <ErrorState error={emailsQuery.error} onRetry={() => void emailsQuery.refetch()} />
              ) : rows.length === 0 ? (
                <EmptyState
                  title={activeTab.empty.title}
                  description={activeTab.empty.description}
                  action={
                    activeTab.id === 'scheduled' ? (
                      <Button size="sm" onClick={() => setComposeOpen(true)}>
                        Schedule an email
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <EmailTable emails={rows} />

                  <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-2.5">
                    <span className="tabular text-xs text-fg-muted">
                      {pagination
                        ? `${(pagination.page - 1) * pagination.pageSize + 1}–${
                            (pagination.page - 1) * pagination.pageSize + rows.length
                          } of ${pagination.total}`
                        : ''}
                    </span>

                    {pagination && pagination.totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pagination.page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <span className="tabular text-xs text-fg-muted">
                          {pagination.page} / {pagination.totalPages}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pagination.page >= pagination.totalPages}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </Panel>

            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-fg-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  emailsQuery.isFetching ? 'bg-st-sent' : 'bg-line-strong'
                }`}
                aria-hidden="true"
              />
              {emailsQuery.isFetching
                ? 'Refreshing…'
                : `Auto-refreshes every ${Math.round(POLL_INTERVAL_MS / 1000)}s`}
            </p>
          </section>

          <MailboxPanel pollIntervalMs={POLL_INTERVAL_MS} />
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
