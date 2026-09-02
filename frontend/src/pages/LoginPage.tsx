import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import MoltenMetal from '../components/MoltenMetal';
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
    <AuthShell title="Sign in to TimedInk" subtitle="Every email, perfectly timed — down to the second.">
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

      <div className="mt-4 rounded-xl bg-white/[0.04] px-4 py-2.5 text-center text-xs text-slate-400 border border-white/[0.08]">
        Seeded account pre-filled for demo review.
      </div>
    </AuthShell>
  );
}

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
    <div className="relative flex min-h-full items-center justify-center px-4 py-12 overflow-hidden selection:bg-violet-500/30">
      {/* MoltenMetal background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <MoltenMetal
          color1="#5227FF"
          color2="#FF9FFC"
          color3="#FFFFFF"
          speed={0.25}
          scale={4}
          detail={3}
          glow={1.6}
          coreSize={0.1}
          swirl={1}
          fold={-0.2}
          blackPoint={0.05}
          brightness={1.0}
          colorMode="molten"
          grain
          grainIntensity={0.04}
          mouseInteraction
          mouseStrength={0.25}
          opacity={0.6}
        />
      </div>

      {/* Glass card */}
      <div className="relative z-10 w-full max-w-sm animate-scale-in">
        <div className="mb-6 text-center">
          {/* Logo Mark */}
          <div className="mx-auto mb-3 flex items-center justify-center">
            <TimedInkLogo size={46} showWordmark={false} />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
            {title}
          </h1>
          <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{subtitle}</p>
        </div>

        <div className="elevation-3 p-6 rounded-2xl border border-white/[0.14]">{children}</div>

        {/* Outbox Labs Product Links */}
        <div className="mt-6 flex items-center justify-center gap-3 text-[11px] text-slate-500">
          <span>Outbox Labs:</span>
          <a href="https://reachinbox.ai/" target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">ReachInbox</a>
          <span className="text-slate-700">·</span>
          <a href="https://zapmail.ai/" target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">Zapmail</a>
          <span className="text-slate-700">·</span>
          <a href="https://mailverify.ai/" target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">Mailverify</a>
        </div>
      </div>
    </div>
  );
}
