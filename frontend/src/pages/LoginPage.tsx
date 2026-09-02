import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import MoltenMetal from '../components/MoltenMetal';

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
      // Send the user back where they were headed before the redirect.
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
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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

        <Button type="submit" loading={submitting} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        No account?{' '}
        <Link to="/register" className="font-medium text-violet-400 hover:text-violet-300 transition-colors">
          Create one
        </Link>
      </p>

      <div className="mt-4 rounded-xl bg-white/[0.04] px-4 py-3 text-center text-xs text-slate-500 ring-1 ring-white/[0.08]">
        Seeded demo account is pre-filled — run <code className="font-mono text-violet-400">npm run seed</code> in
        the backend first.
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
    <div className="relative flex min-h-full items-center justify-center px-4 py-12 overflow-hidden">
      {/* MoltenMetal background */}
      <div className="fixed inset-0 z-0">
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
        <div className="mb-8 text-center">
          {/* Logo */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-500 shadow-[0_0_30px_rgba(139,92,246,0.4)]">
            <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-heading)' }}>
            {title}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
        </div>

        <div className="glass-panel p-6 glow-purple gradient-border">{children}</div>

        {/* Product links */}
        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-600">
          <span>An Outbox Labs product</span>
          <span className="text-slate-700">·</span>
          <a href="https://reachinbox.ai/" target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">ReachInbox</a>
          <a href="https://zapmail.ai/" target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">Zapmail</a>
          <a href="https://mailverify.ai/" target="_blank" rel="noreferrer" className="hover:text-violet-400 transition-colors">Mailverify</a>
        </div>
      </div>
    </div>
  );
}
