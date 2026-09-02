import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import Particles from '../components/Particles';
import TimedInkLogo from '../components/TimedInkLogo';

/** Matches prisma/seed.ts so a reviewer never has to guess. */
const DEMO = { email: 'demo@outboxpilot.dev', password: 'demo1234' };

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState(DEMO.email);
  const [password, setPassword] = useState(DEMO.password);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.fieldMessages[0] ?? err.message
          : 'Could not sign in. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Precision outbound scheduling with warmup-aware delivery.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}

        <Field label="Email" required>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password" required>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" loading={submitting} className="w-full mt-2">
          Sign in
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-400">
        No account?{' '}
        <Link to="/register" className="font-semibold text-violet-400 hover:text-violet-300 transition-colors">
          Create one
        </Link>
      </p>

      <div className="mt-4 rounded-xl bg-white/[0.06] px-4 py-2.5 text-center text-xs text-slate-300 border border-white/[0.12]">
        Seeded account pre-filled for demo review.
      </div>
    </AuthShell>
  );
}

const AUTH_PARTICLE_COLORS = ['#ffffff', '#f5d0fe', '#c084fc', '#a855f7', '#818cf8', '#38bdf8', '#e879f9'];

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="immersive-bg relative flex min-h-full items-center justify-center px-4 py-10 overflow-hidden selection:bg-violet-500/30">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Particles
          particleColors={AUTH_PARTICLE_COLORS}
          particleCount={110}
          particleSpread={9}
          speed={0.05}
          particleBaseSize={95}
          moveParticlesOnHover={false}
          disableRotation
          sizeRandomness={0.55}
          cameraDistance={18}
          pixelRatio={1}
          fpsLimit={30}
          className="opacity-55"
        />
      </div>

      <div className="relative z-10 grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="hidden lg:block">
          <div className="mb-8">
            <TimedInkLogo size={42} showWordmark={true} />
            <h1 className="mt-7 max-w-2xl text-5xl font-black leading-[0.98] tracking-tight text-white xl:text-6xl" style={{ fontFamily: 'var(--font-heading)' }}>
              Send at the exact moment attention is highest.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
              TimedInk blends email scheduling, sender rotation, warmup limits, retries, and live tracking into one calm operator surface.
            </p>
          </div>

          <div className="glass-panel elevation-3 relative max-w-2xl overflow-hidden p-5">
            <div className="absolute right-8 top-8 h-44 w-44 rounded-full border border-white/10" />
            <div className="absolute right-16 top-14 h-28 w-28 rounded-full border border-[var(--color-aqua)]/25" />
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-aqua)]">Live Campaign Deck</p>
                <p className="mt-1 text-sm text-slate-300">Today, warmup protected</p>
              </div>
              <div className="rounded-full border border-[var(--color-aqua)]/30 bg-[var(--color-aqua)]/10 px-3 py-1 text-xs font-bold text-[var(--color-aqua)]">
                synced
              </div>
            </div>

            <div className="grid gap-3 py-4 sm:grid-cols-3">
              {[
                ['Scheduled', '128', 'next 24h'],
                ['Delivered', '2.4k', '99.1% OK'],
                ['Opened', '41%', '+8.2%'],
              ].map(([label, value, hint]) => (
                <div key={label} className="sheen-hover rounded-xl border border-white/10 bg-white/[0.06] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
                  <p className="mt-1.5 text-2xl font-black text-white" style={{ fontFamily: 'var(--font-heading)' }}>{value}</p>
                  <p className="mt-1 text-xs text-slate-400">{hint}</p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {[
                ['11:30', 'Founder follow-up', 'Queued', 'text-[var(--color-gold)] bg-[var(--color-gold)]/10'],
                ['13:05', 'API integration intro', 'Sending', 'text-[var(--color-aqua)] bg-[var(--color-aqua)]/10'],
                ['17:20', 'Investor update', 'Warmup limited', 'text-[var(--color-coral)] bg-[var(--color-coral)]/10'],
              ].map(([time, subject, status, badgeClass]) => (
                <div key={subject} className="flex items-center gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <span className="font-mono text-xs text-slate-400">{time}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{subject}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${badgeClass}`}>
                    {status}
                  </span>
                </div>
              ))}
            </div>
            <div className="aurora-line mt-5" />
          </div>
        </section>

        <section className="w-full max-w-md justify-self-center lg:justify-self-end">
          <div className="mb-6 text-center lg:text-left">
            <div className="mx-auto mb-4 flex items-center justify-center lg:hidden">
              <TimedInkLogo size={46} showWordmark={true} />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-aqua)]">Outbox Pilot</p>
            <h2 className="text-3xl font-extrabold text-white tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
              {title}
            </h2>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">{subtitle}</p>
          </div>

          <div className="glass-panel elevation-3 p-6">{children}</div>

          <div className="mt-6 flex items-center justify-center gap-3 text-[11px] text-slate-500">
            <span>Outbox Labs</span>
            <a href="https://reachinbox.ai/" target="_blank" rel="noreferrer" className="hover:text-[var(--color-aqua)] transition-colors">ReachInbox</a>
            <span className="text-slate-700">/</span>
            <a href="https://zapmail.ai/" target="_blank" rel="noreferrer" className="hover:text-[var(--color-aqua)] transition-colors">Zapmail</a>
            <span className="text-slate-700">/</span>
            <a href="https://mailverify.ai/" target="_blank" rel="noreferrer" className="hover:text-[var(--color-aqua)] transition-colors">Mailverify</a>
          </div>
        </section>
      </div>
    </div>
  );
}
