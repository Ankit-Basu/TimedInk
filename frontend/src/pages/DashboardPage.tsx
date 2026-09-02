import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, EmptyState, ErrorState, LoadingState } from '../components/ui';
import EmailTable from '../features/emails/EmailTable';
import ComposeModal from '../features/emails/ComposeModal';
import EmailDetailDrawer from '../features/emails/EmailDetailDrawer';
import MailboxPanel from '../features/mailboxes/MailboxPanel';
import Logo from '../components/Logo';
import { useDocumentTitle } from '../lib/useDocumentTitle';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeTab = TABS.find((t) => t.id === activeTabId) ?? TABS[0]!;

  useDocumentTitle(activeTab.label);

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
  const total = statsQuery.data?.total ?? null;

  return (
    <div className="min-h-full p-3 sm:p-5">
      {/* First focusable element: lets keyboard users jump the masthead. */}
      <a
        href="#queue"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50
          focus:rounded-sm focus:border focus:border-field focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px]"
      >
        Skip to the queue
      </a>

      <div className="frame min-h-[calc(100vh-1.5rem)] sm:min-h-[calc(100vh-2.5rem)]">
        {/* --- masthead ---------------------------------------------------- */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-rule px-6 py-4 sm:px-8">
          <Logo />

          <div className="flex items-center gap-3">
            <span className="label hidden sm:inline">{user?.email}</span>
            <Button onClick={() => setComposeOpen(true)}>
              New email
              <kbd className="mono ml-1 hidden rounded-sm border border-ink/25 px-1 text-[10px] font-normal sm:inline">
                c
              </kbd>
            </Button>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>

        {/* --- title block -------------------------------------------------- */}
        <main id="queue">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-rule px-6 py-6 sm:px-8 sm:py-8">
            <div>
              <p className="label mb-3">The queue</p>
              <h1 className="display text-[1.85rem] sm:text-5xl">
                Everything you&apos;ve scheduled,
                <br />
                <span className="text-ink-3 italic">and where it got to.</span>
              </h1>
            </div>

            <dl className="flex gap-8">
              <div>
                <dt className="label">Total</dt>
                <dd className="mono mt-1.5 text-2xl">{total ?? '—'}</dd>
              </div>
              <div>
                <dt className="label">Refresh</dt>
                <dd className="mono mt-1.5 text-2xl">{Math.round(POLL_INTERVAL_MS / 1000)}s</dd>
              </div>
            </dl>
          </div>

          {/* --- body --------------------------------------------------------- */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <section className="min-w-0 border-b border-rule lg:border-r lg:border-b-0">
              {/* Grid nav: evenly divided, ruled, with a filled marker on the active tab. */}
              <nav
                className="grid grid-cols-2 border-b border-rule sm:grid-cols-4"
                aria-label="Filter by status"
              >
                {TABS.map((tab, i) => {
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
                      className={`group flex items-baseline justify-between gap-2 px-5 py-3.5 text-left transition-colors
                        ${i > 0 ? 'border-l border-rule' : ''}
                        ${active ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}
                    >
                      <span className="flex items-baseline gap-2">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full transition-colors ${
                            active ? 'bg-accent' : 'bg-transparent'
                          }`}
                          aria-hidden="true"
                        />
                        <span
                          className={`text-[13px] ${active ? 'font-medium text-ink' : 'text-ink-2'}`}
                        >
                          {tab.label}
                        </span>
                      </span>
                      <span className={`mono text-xs ${active ? 'text-ink' : 'text-ink-3'}`}>
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
                      <Button onClick={() => setComposeOpen(true)}>Schedule an email</Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <EmailTable emails={rows} onSelect={setSelectedId} />

                  <div className="flex items-center justify-between gap-4 border-t border-rule px-6 py-3.5 sm:px-8">
                    <span className="label">
                      {pagination
                        ? `${(pagination.page - 1) * pagination.pageSize + 1}–${
                            (pagination.page - 1) * pagination.pageSize + rows.length
                          } of ${pagination.total}`
                        : ''}
                    </span>

                    {pagination && pagination.totalPages > 1 && (
                      <div className="flex items-center gap-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pagination.page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <span className="mono text-xs text-ink-3">
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

              <div className="flex items-center gap-2 px-6 py-3 sm:px-8">
                <span
                  className={`h-1 w-1 rounded-full ${
                    emailsQuery.isFetching ? 'bg-accent' : 'bg-rule-strong'
                  }`}
                  aria-hidden="true"
                />
                <span className="label">
                  {emailsQuery.isFetching
                    ? 'Refreshing'
                    : `Auto-refreshes every ${Math.round(POLL_INTERVAL_MS / 1000)}s`}
                </span>
              </div>
            </section>

            <MailboxPanel pollIntervalMs={POLL_INTERVAL_MS} />
          </div>
        </main>
      </div>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
      <EmailDetailDrawer emailId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
