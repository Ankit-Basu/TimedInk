import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, Button, EmptyState, ErrorState, LoadingState } from '../components/ui';
import EmailTable from '../features/emails/EmailTable';
import ComposeModal from '../features/emails/ComposeModal';
import type { ComposeDraft } from '../features/emails/ComposeModal';
import EmailDetailDrawer from '../features/emails/EmailDetailDrawer';
import ThroughputPanel from '../features/emails/ThroughputPanel';
import MailboxPanel from '../features/mailboxes/MailboxPanel';
import Background from '../components/Background';
import Logo from '../components/Logo';
import SplitText from '../components/reactbits/SplitText';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import { CountUp, gsap, prefersReducedMotion, useGSAP, useSmoothScroll } from '../lib/motion';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useDebounced } from '../lib/useDebounced';
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
  /** Colour of the stat card glow and the tab's count chip. */
  tone: string;
  empty: { title: string; description: string };
}

const TABS: Tab[] = [
  {
    id: 'scheduled',
    label: 'Scheduled',
    statuses: ['PENDING', 'QUEUED', 'SENDING'],
    tone: 'rgba(124, 180, 255, 0.35)',
    empty: {
      title: 'Nothing scheduled',
      description: 'Emails you schedule will appear here until the worker sends them.',
    },
  },
  {
    id: 'sent',
    label: 'Sent',
    statuses: ['SENT'],
    tone: 'rgba(74, 222, 128, 0.3)',
    empty: {
      title: 'Nothing sent yet',
      description: 'Once an email goes out it lands here with a link to its Ethereal preview.',
    },
  },
  {
    id: 'failed',
    label: 'Failed',
    statuses: ['FAILED'],
    tone: 'rgba(251, 113, 133, 0.32)',
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
    tone: 'rgba(167, 139, 250, 0.32)',
    empty: {
      title: 'Nothing cancelled',
      description: 'Cancelling a scheduled email removes its queued job and files it here.',
    },
  },
];

const STAT_ICONS: Record<string, string> = {
  scheduled: 'M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  sent: 'm5 13 4 4L19 7',
  failed: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  cancelled: 'M18.4 5.6 5.6 18.4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Ticks the seconds down to the next poll.
 *
 * Deliberately its own component with its own state: a `setInterval` in
 * DashboardPage would re-render the whole table — and the open drawer — once a
 * second for the sake of one digit.
 */
function RefreshCountdown({ pollIntervalMs, isFetching }: { pollIntervalMs: number; isFetching: boolean }) {
  const seconds = Math.max(1, Math.round(pollIntervalMs / 1000));
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? seconds : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);

  // A fetch can land early — a mutation invalidates the query — so restart the
  // count from the top whenever one does, or the number drifts from reality.
  useEffect(() => {
    if (isFetching) setRemaining(seconds);
  }, [isFetching, seconds]);

  return <span className="tabular-nums">{isFetching ? 'syncing' : `${remaining}s`}</span>;
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [activeTabId, setActiveTabId] = useState(TABS[0]!.id);
  const [page, setPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [search, setSearch] = useState('');
  // Only the settled value reaches the query key, so typing does not fire a
  // request per keystroke.
  const debouncedSearch = useDebounced(search.trim(), 300);

  const root = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const indicatorRef = useRef<HTMLSpanElement>(null);

  const activeTab = TABS.find((t) => t.id === activeTabId) ?? TABS[0]!;

  useDocumentTitle(activeTab.label);
  useSmoothScroll();

  const emailsQuery = useQuery({
    queryKey: ['emails', activeTab.id, page, debouncedSearch],
    queryFn: () =>
      api.listEmails({
        status: activeTab.statuses,
        page,
        pageSize: PAGE_SIZE,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
      }),
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
      statsQuery.data ? tab.statuses.reduce((sum, s) => sum + (statsQuery.data.counts[s] ?? 0), 0) : null,
    [statsQuery.data],
  );

  const openCompose = useCallback(() => {
    setDraft(null);
    setComposeOpen(true);
  }, []);

  // `c` opens the composer, Escape closes it. Cheap, and the kind of thing an
  // operator who lives in this screen all day will use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      openCompose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCompose]);

  // A new search must not land the user on page 4 of the previous result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Page entrance: header drops in, then the cards and panels rise in order.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.from('[data-enter="header"]', { y: -30, opacity: 0, duration: 0.9 })
        .from('[data-enter="stat"]', { y: 30, opacity: 0, filter: 'blur(8px)', duration: 0.9, stagger: 0.07 }, '-=0.6')
        .from('[data-enter="panel"]', { y: 40, opacity: 0, duration: 1, stagger: 0.1 }, '-=0.7');
    },
    { scope: root },
  );

  // The tab indicator glides to the active tab rather than jumping.
  useLayoutEffect(() => {
    const target = tabRefs.current[activeTab.id];
    const indicator = indicatorRef.current;
    if (!target || !indicator) return;
    const props = { x: target.offsetLeft, width: target.offsetWidth };
    if (prefersReducedMotion()) gsap.set(indicator, props);
    else gsap.to(indicator, { ...props, duration: 0.55, ease: 'expo.out' });
  }, [activeTab.id, statsQuery.data]);

  const selectTab = (id: string) => {
    setActiveTabId(id);
    setPage(1);
  };

  const pagination = emailsQuery.data?.pagination;
  const rows = emailsQuery.data?.data ?? [];
  const firstName = user?.name.split(/\s+/)[0] ?? 'there';

  return (
    <div ref={root} className="relative min-h-screen pb-16">
      <Background variant="app" />

      {/* First focusable element: lets keyboard users jump the masthead. */}
      <a
        href="#queue"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-xl focus:bg-night-2 focus:px-3 focus:py-2 focus:text-[13px]"
      >
        Skip to the queue
      </a>

      {/* --- header ----------------------------------------------------------- */}
      <header data-enter="header" className="sticky top-0 z-30 px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="glass mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-2xl px-4 py-2.5 sm:px-5">
          <Logo />

          <div className="flex items-center gap-2 sm:gap-3">
            <Button onClick={openCompose} className="hidden sm:inline-flex">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              New email
              <kbd className="mono ml-0.5 rounded-md border border-black/20 bg-black/10 px-1.5 text-[10px] font-normal">c</kbd>
            </Button>

            <div className="flex items-center gap-3 rounded-xl border border-edge bg-white/[0.04] py-1 pr-1 pl-1.5">
              <Avatar name={user?.name ?? ''} src={user?.avatarUrl} size={32} />
              <div className="hidden min-w-0 leading-tight md:block">
                <p className="truncate text-[13px] font-medium text-ink">{user?.name}</p>
                <p className="mono truncate text-[11px] text-ink-3">{user?.email}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out" title="Sign out">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3m5-3 3-3-3-3m3 3H8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden lg:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main id="queue" className="mx-auto max-w-7xl px-3 sm:px-5">
        {/* --- title ---------------------------------------------------------- */}
        <div className="flex flex-wrap items-end justify-between gap-6 pt-10 pb-8 sm:pt-14">
          <div>
            <p className="label mb-3">{greeting()}, {firstName}</p>
            <h1 className="headline text-5xl sm:text-6xl">
              <SplitText text="Your send queue," tag="span" textAlign="left" effect="rise" trigger="load" delay={20} className="block" />
              <span className="block">
                <span className="display text-gradient">live</span> and on schedule.
              </span>
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="glass flex items-center gap-2.5 rounded-full px-4 py-2">
              <span className={`h-2 w-2 rounded-full ${emailsQuery.isFetching ? 'bg-accent pulse-ring text-accent' : 'bg-st-sent'}`} aria-hidden="true" />
              <span className="mono text-xs text-ink-2">
                Auto-refresh · <RefreshCountdown pollIntervalMs={POLL_INTERVAL_MS} isFetching={emailsQuery.isFetching} />
              </span>
            </div>
            <Button onClick={openCompose} className="sm:hidden">
              New email
            </Button>
          </div>
        </div>

        {/* --- stat cards ---------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {TABS.map((tab) => {
            const count = countFor(tab);
            const active = tab.id === activeTab.id;
            return (
              <div key={tab.id} data-enter="stat">
                <SpotlightCard
                  spotlightColor={tab.tone}
                  className={`h-full rounded-3xl backdrop-blur-xl transition-transform duration-300 hover:-translate-y-1 ${
                    active ? 'ring-1 ring-white/25' : ''
                  }`}
                  style={
                    {
                      '--spotlight-card-surface': active ? 'rgba(40, 29, 54, 0.9)' : 'rgba(24, 17, 34, 0.82)',
                      '--spotlight-card-border': 'rgba(255,255,255,0.09)',
                    } as React.CSSProperties
                  }
                >
                  <button
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    className="block w-full cursor-pointer p-5 text-left sm:p-6"
                    aria-pressed={active}
                  >
                    <div className="flex items-center justify-between">
                      <span className="label">{tab.label}</span>
                      <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/[0.06]" style={{ color: tab.tone.replace(/[\d.]+\)$/, '1)') }}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d={STAT_ICONS[tab.id]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>
                    <p className="headline mt-4 text-5xl sm:text-[3.4rem]">
                      {count === null ? <span className="text-ink-3">—</span> : <CountUp value={count} />}
                    </p>
                  </button>
                </SpotlightCard>
              </div>
            );
          })}
        </div>

        {/* --- body ------------------------------------------------------------ */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section data-enter="panel" className="glass min-w-0 overflow-hidden rounded-3xl" aria-label="Emails">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3.5 sm:px-5">
              {/* Segmented tabs with a gliding indicator. */}
              <nav className="well relative flex rounded-2xl p-1" aria-label="Filter by status">
                <span
                  ref={indicatorRef}
                  className="absolute top-1 bottom-1 left-0 rounded-xl bg-gradient-to-b from-[#ffc56b] to-[#f2862e] shadow-[0_4px_20px_-6px_rgb(255_165_60/0.7)]"
                  aria-hidden="true"
                />
                {TABS.map((tab) => {
                  const active = tab.id === activeTab.id;
                  const count = countFor(tab);
                  return (
                    <button
                      key={tab.id}
                      ref={(el) => {
                        tabRefs.current[tab.id] = el;
                      }}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => selectTab(tab.id)}
                      className={`relative z-10 flex h-8 cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] font-medium transition-colors sm:px-3.5 ${
                        active ? 'text-night font-semibold' : 'text-ink-3 hover:text-ink'
                      }`}
                    >
                      {tab.label}
                      <span className={`mono text-[11px] ${active ? 'text-night/70' : 'text-ink-3'}`}>{count ?? '–'}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Free-text filter over recipient and subject (API: ?q=). */}
              <div className="well flex min-w-[220px] flex-1 items-center gap-2.5 rounded-2xl px-3.5 py-2 transition-colors focus-within:border-accent/60 sm:max-w-xs">
                <svg className="h-4 w-4 shrink-0 text-ink-3" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search recipient or subject"
                  aria-label="Filter emails by recipient or subject"
                  className="w-full border-0 bg-transparent p-0 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="label shrink-0 cursor-pointer transition-colors hover:text-ink">
                    Clear
                  </button>
                )}
              </div>
            </div>

            {emailsQuery.isPending ? (
              <LoadingState />
            ) : emailsQuery.isError ? (
              <ErrorState error={emailsQuery.error} onRetry={() => void emailsQuery.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState
                title={debouncedSearch ? 'No matches' : activeTab.empty.title}
                description={
                  debouncedSearch
                    ? `Nothing in ${activeTab.label.toLowerCase()} matches "${debouncedSearch}".`
                    : activeTab.empty.description
                }
                action={
                  debouncedSearch ? (
                    <Button variant="secondary" onClick={() => setSearch('')}>
                      Clear filter
                    </Button>
                  ) : activeTab.id === 'scheduled' ? (
                    <Button onClick={openCompose}>Schedule an email</Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <EmailTable
                  emails={rows}
                  onSelect={setSelectedId}
                  variant={activeTab.id === 'sent' ? 'sent' : 'scheduled'}
                />

                <div className="flex items-center justify-between gap-4 border-t border-edge px-5 py-3.5">
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
                        ← Prev
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
                        Next →
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="space-y-5">
            <div data-enter="panel">
              <ThroughputPanel pollIntervalMs={POLL_INTERVAL_MS} />
            </div>
            <div data-enter="panel">
              <MailboxPanel pollIntervalMs={POLL_INTERVAL_MS} />
            </div>
          </aside>
        </div>
      </main>

      <ComposeModal open={composeOpen} draft={draft} onClose={() => setComposeOpen(false)} />
      <EmailDetailDrawer
        emailId={selectedId}
        onClose={() => setSelectedId(null)}
        onDuplicate={(email) => {
          setDraft({
            to: email.to,
            cc: email.cc ?? '',
            subject: email.subject,
            body: email.bodyText,
            followUpAfterHours: email.followUpAfterHours ? String(email.followUpAfterHours) : '',
          });
          setSelectedId(null);
          setComposeOpen(true);
        }}
      />
    </div>
  );
}
