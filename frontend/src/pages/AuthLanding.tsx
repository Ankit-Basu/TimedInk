import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Background, { HeroBurst, SectionRays } from '../components/Background';
import Logo from '../components/Logo';
import SendPass from '../components/SendPass';
import SplitText from '../components/reactbits/SplitText';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import Magnet from '../components/reactbits/Magnet';
import { CloseIcon } from '../components/ui';
import { useFocusTrap } from '../lib/useFocusTrap';
import { CountUp, gsap, prefersReducedMotion, ScrollTrigger, useGSAP, useReveal, useSmoothScroll } from '../lib/motion';

/**
 * The signed-out experience: a scrolling product page, with sign-in in a
 * slide-over panel so the hero can be all story.
 *
 * A reviewer's first thirty seconds happen here, so it does two jobs at once —
 * get them into the app in one click, and explain what the system underneath
 * actually guarantees — with the scroll walking through the same pipeline the
 * backend implements.
 */

const FEATURES = [
  {
    title: 'Delayed BullMQ jobs',
    body: 'Every email is a delayed job keyed on its MySQL id. No cron, no polling loop — Redis wakes the worker at the exact millisecond.',
    icon: 'M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  },
  {
    title: 'Survives restarts',
    body: 'MySQL is the source of truth. On boot the reconciler replays intent onto the queue with deterministic job ids, so nothing is lost or sent twice.',
    icon: 'M4 4v5h5M20 20v-5h-5M5.1 15a7 7 0 0 0 12.9 2.3M18.9 9A7 7 0 0 0 6 6.7',
  },
  {
    title: 'Rate-limited by design',
    body: 'Global and per-sender hourly ceilings plus a minimum gap between sends, enforced atomically in Redis across every worker.',
    icon: 'M3 12h4l3-8 4 16 3-8h4',
  },
  {
    title: 'CSV bulk scheduling',
    body: 'Drop a CSV of leads; addresses are parsed in the browser, spaced by your delay and rolled into later hours when your hourly cap is hit.',
    icon: 'M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2ZM9 13h6M9 17h6',
  },
  {
    title: 'Real SMTP, fake inbox',
    body: 'Sends go over genuine SMTP to Ethereal. Every sent email links to a real preview of exactly what the recipient would have seen.',
    icon: 'M3 7.5 12 13l9-5.5M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5Z',
  },
  {
    title: 'Full audit timeline',
    body: 'Every transition writes an immutable event. Open any email to see when it was queued, deferred, retried, sent and opened.',
    icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
  },
];

const STEPS = [
  { k: '01', title: 'Compose', body: 'One email or a CSV of thousands. Times are converted to UTC in the browser.' },
  { k: '02', title: 'Persist', body: 'The row is written to MySQL first — the durable record of intent.' },
  { k: '03', title: 'Enqueue', body: 'A delayed BullMQ job with jobId email-<id>. Replaying it is a no-op.' },
  { k: '04', title: 'Deliver', body: 'The worker re-reads the row, checks limits, and sends over SMTP.' },
];

const STACK = ['TypeScript', 'Express', 'BullMQ', 'Redis 7', 'MySQL 8', 'Prisma', 'Nodemailer', 'Ethereal', 'React 19', 'Tailwind 4', 'GSAP', 'TanStack Query'];

function FeatureIcon({ d }: { d: string }) {
  return (
    <span className="ring-gradient grid h-11 w-11 place-items-center rounded-xl bg-amber/[0.07]">
      <svg className="h-5 w-5 text-amber" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Sign-in modal presented front and center over a dimmed, blurred backdrop. */
function AuthPanel({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    if (!prefersReducedMotion()) {
      gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25 });
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, scale: 0.95, y: 16 },
        { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: 'power3.out' }
      );
    }
    // Put the caret in the first field.
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLInputElement>('input')?.focus());
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, panelRef]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-night/80 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className="relative w-full max-w-[460px] my-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-5 right-5 z-20 grid h-8 w-8 cursor-pointer place-items-center rounded-xl bg-white/[0.06] border border-edge text-ink-3 transition-colors hover:bg-white/15 hover:text-ink"
        >
          <CloseIcon />
        </button>
        {children}
      </div>
    </div>
  );
}

export default function AuthLanding({ card, defaultOpen = false }: { card: ReactNode; defaultOpen?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [authOpen, setAuthOpen] = useState(defaultOpen);
  const openAuth = useCallback(() => setAuthOpen(true), []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  useSmoothScroll();
  useReveal(root);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;

      gsap.from('[data-hero]', {
        opacity: 0,
        y: 20,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.08,
        delay: 0.15,
      });
      gsap.from('[data-pass]', { opacity: 0, x: 60, rotate: 5, duration: 1.1, ease: 'expo.out', delay: 0.35 });

      // Hero copy drifts up and the ticket lifts away as you scroll past.
      const away = { trigger: '[data-hero-section]', start: 'top top', end: 'bottom top', scrub: true };
      gsap.to('[data-hero-copy]', { yPercent: -12, opacity: 0.2, ease: 'none', scrollTrigger: away });
      gsap.to('[data-pass]', { yPercent: -30, rotate: -4, ease: 'none', scrollTrigger: away });

      // Pipeline: the progress line fills and each step lights up as it is reached.
      const steps = gsap.utils.toArray<HTMLElement>('[data-step]');
      gsap.fromTo(
        '[data-progress]',
        { scaleX: 0 },
        {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: { trigger: '[data-pipeline]', start: 'top 70%', end: 'bottom 55%', scrub: 0.6 },
        },
      );
      steps.forEach((step, i) => {
        ScrollTrigger.create({
          trigger: '[data-pipeline]',
          start: () => `top+=${i * 90} 70%`,
          onEnter: () => step.classList.add('is-lit'),
          onLeaveBack: () => step.classList.remove('is-lit'),
        });
      });

      // Statement: words warm up one by one with the scroll.
      gsap.fromTo(
        '[data-word]',
        { opacity: 0.14 },
        {
          opacity: 1,
          stagger: 0.1,
          ease: 'none',
          scrollTrigger: { trigger: '[data-statement]', start: 'top 80%', end: 'bottom 50%', scrub: true },
        },
      );
    },
    { scope: root },
  );

  const statement =
    'Write it now. Send it exactly when you meant to — through restarts, a wiped Redis, and a provider that throttles you.';

  return (
    <div ref={root} className="relative min-h-screen">
      <Background variant="landing" />

      {/* --- nav ------------------------------------------------------------ */}
      <header className="fixed inset-x-0 top-0 z-30 px-4 pt-4 sm:px-6">
        <nav className="glass mx-auto flex max-w-7xl items-center justify-between rounded-2xl px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="mono hidden rounded-md bg-amber px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-night sm:inline">
              BULLMQ
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a href="#pipeline" className="hidden rounded-full border border-edge px-4 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-edge-strong hover:text-ink md:inline-block">
              How it works
            </a>
            <a href="#features" className="hidden rounded-full border border-edge px-4 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-edge-strong hover:text-ink md:inline-block">
              Features
            </a>
            <button type="button" onClick={openAuth} className="btn-dark h-9 cursor-pointer rounded-xl px-4 text-[13px] font-semibold">
              Open app
            </button>
          </div>
        </nav>
      </header>

      <main>
        {/* --- hero --------------------------------------------------------- */}
        <section data-hero-section className="relative min-h-screen overflow-hidden">
          <HeroBurst className="inset-y-0 right-[-10%] left-[10%] lg:left-[25%]" />
          {/* Feather the rays into the background cleanly without expensive CSS WebGL maskImage */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_70%_at_60%_50%,transparent_35%,#0b0812_82%)]" aria-hidden="true" />
          {/* Keeps the headline side dark enough to read over the rays. */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#0b0812_0%,rgb(11_8_18/0.75)_32%,transparent_62%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-night to-transparent" aria-hidden="true" />

          <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 items-center gap-12 px-5 pt-32 pb-24 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:pt-24">
            <div data-hero-copy className="max-w-2xl">
              <p data-hero className="label mb-7 flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
                </span>
                BullMQ · Redis · MySQL · Ethereal SMTP
              </p>

              <h1 className="headline text-[3.2rem] text-ink sm:text-[4.6rem] lg:text-[5.6rem]">
                <SplitText text="Every email," tag="span" textAlign="left" effect="rise" trigger="load" delay={20} className="block" />
                <span className="block">
                  <span data-hero className="display text-gradient inline-block pr-[0.12em]">
                    exactly
                  </span>{' '}
                  <SplitText text="on time." tag="span" textAlign="left" effect="rise" trigger="load" delay={20} />
                </span>
                <SplitText text="Even after a restart." tag="span" textAlign="left" effect="rise" trigger="load" delay={18} className="block text-ink-2" />
              </h1>

              <p data-hero className="mt-8 max-w-lg text-[16px] leading-relaxed text-ink-2">
                Schedule one email or a whole CSV of leads. Delayed BullMQ jobs, hourly rate limits and a
                live dashboard — and nothing lost or sent twice when the server goes down.
              </p>

              <div data-hero className="mt-10 flex flex-wrap items-center gap-3">
                <Magnet padding={60} magnetStrength={3}>
                  <button type="button" onClick={openAuth} className="btn-primary h-12 cursor-pointer rounded-2xl px-6 text-[15px] font-semibold">
                    Start scheduling →
                  </button>
                </Magnet>
                <a href="#pipeline" className="btn-dark inline-flex h-12 items-center rounded-2xl px-6 text-[15px] font-semibold">
                  See why it can&apos;t double-send
                </a>
              </div>
            </div>

            <div data-pass className="relative flex justify-center lg:justify-end">
              <SendPass />
            </div>
          </div>

          <a href="#stack" className="label absolute bottom-8 left-1/2 -translate-x-1/2 transition-colors hover:text-ink">
            ↓ Scroll
          </a>
        </section>

        {/* --- stack marquee ------------------------------------------------ */}
        <section id="stack" className="relative border-y border-edge bg-night-2/60 py-6">
          <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
            <div className="marquee flex w-max gap-12">
              {[...STACK, ...STACK].map((item, i) => (
                <span key={i} className="mono flex items-center gap-12 text-sm text-ink-3">
                  {item}
                  <span className="h-1 w-1 rounded-full bg-amber/60" aria-hidden="true" />
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* --- features ----------------------------------------------------- */}
        <section id="features" className="mx-auto max-w-7xl px-5 py-28 sm:px-6">
          <div data-reveal className="max-w-2xl">
            <p className="label mb-5">What&apos;s under the hood</p>
            <h2 className="headline text-5xl sm:text-6xl">
              Built like the real thing, <span className="display text-gradient">not</span> a weekend demo.
            </h2>
          </div>

          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} data-reveal>
                <SpotlightCard
                  className="h-full rounded-3xl p-7"
                  spotlightColor="rgba(255, 181, 71, 0.28)"
                  style={
                    {
                      '--spotlight-card-surface': 'rgba(24, 17, 34, 0.82)',
                      '--spotlight-card-border': 'rgba(255,240,220,0.09)',
                    } as React.CSSProperties
                  }
                >
                  <FeatureIcon d={feature.icon} />
                  <h3 className="headline mt-6 text-[1.6rem]">{feature.title}</h3>
                  <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-3">{feature.body}</p>
                </SpotlightCard>
              </div>
            ))}
          </div>
        </section>

        {/* --- pipeline (scroll-driven) ------------------------------------- */}
        <section id="pipeline" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
          <div data-reveal className="max-w-2xl">
            <p className="label mb-5">How it works</p>
            <h2 className="headline text-5xl sm:text-6xl">
              Four steps from draft to <span className="display text-gradient">delivered.</span>
            </h2>
          </div>

          <div data-pipeline className="relative mt-16">
            <div className="absolute top-[26px] right-0 left-0 hidden h-px bg-white/10 lg:block" aria-hidden="true">
              <div data-progress className="h-full origin-left bg-gradient-to-r from-amber via-ember to-plum" />
            </div>
            <ol className="grid gap-5 lg:grid-cols-4">
              {STEPS.map((step) => (
                <li
                  key={step.k}
                  data-step
                  className="group relative [&.is-lit_.step-card]:border-amber/30 [&.is-lit_.step-dot]:border-transparent [&.is-lit_.step-dot]:bg-gradient-to-b [&.is-lit_.step-dot]:from-[#ffc56b] [&.is-lit_.step-dot]:to-ember [&.is-lit_.step-dot]:text-night [&.is-lit_.step-dot]:shadow-[0_0_30px_rgb(255_165_60/0.55)]"
                >
                  <span className="step-dot glass mono relative z-10 grid h-[52px] w-[52px] place-items-center rounded-2xl text-sm font-semibold text-ink-2 transition-all duration-500">
                    {step.k}
                  </span>
                  <div className="step-card glass mt-5 rounded-2xl p-6 transition-all duration-500">
                    <h3 className="headline text-2xl">{step.title}</h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --- statement + numbers ------------------------------------------ */}
        <section className="mx-auto max-w-5xl px-5 py-28 sm:px-6">
          <p data-statement className="headline text-center text-4xl leading-[1.1] sm:text-6xl">
            {statement.split(' ').map((word, i) => (
              <span key={i} data-word className="inline-block pr-[0.25em]">
                {word}
              </span>
            ))}
          </p>

          <div className="mt-20 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { n: 73, suffix: '', label: 'hermetic tests' },
              { n: 3, suffix: '', label: 'hourly limit scopes' },
              { n: 1000, suffix: '', label: 'recipients per CSV' },
              { n: 100, suffix: '%', label: 'jobs recovered on boot' },
            ].map((stat) => (
              <div key={stat.label} data-reveal className="glass rounded-3xl p-6 text-center">
                <p className="headline text-5xl text-amber">
                  <CountUp value={stat.n} duration={2} />
                  {stat.suffix}
                </p>
                <p className="label mt-3">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* --- closing CTA, under falling light ------------------------------ */}
        <section className="relative overflow-hidden px-5 pt-10 pb-28 sm:px-6">
          <SectionRays />
          <div data-reveal className="relative mx-auto max-w-4xl py-20 text-center">
            <h2 className="headline text-5xl sm:text-7xl">
              Ready when <span className="display text-gradient">you</span> are.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] text-ink-2">
              Sign in with Google or the seeded demo account and schedule your first email in under a minute.
            </p>
            <div className="mt-9 flex justify-center">
              <Magnet padding={60} magnetStrength={3}>
                <button type="button" onClick={openAuth} className="btn-primary h-12 cursor-pointer rounded-2xl px-7 text-[15px] font-semibold">
                  Open the dashboard →
                </button>
              </Magnet>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-edge px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-xs text-ink-3">
          <Logo size={24} />
          <span className="mono">Express · BullMQ · MySQL · React — built for the ReachInbox assignment</span>
        </div>
      </footer>

      <AuthPanel open={authOpen} onClose={closeAuth}>
        {card}
      </AuthPanel>
    </div>
  );
}
