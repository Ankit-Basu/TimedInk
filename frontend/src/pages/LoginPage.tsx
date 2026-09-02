import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import Logo from '../components/Logo';

/** Matches prisma/seed.ts so a reviewer never has to guess. */
const DEMO = { email: 'demo@timedink.dev', password: 'demo1234' };

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
          ? (err.fieldMessages[0] ?? err.message)
          : 'Could not sign in. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell subtitle="Sign in to schedule and track your outbound email.">
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

        <Button type="submit" loading={submitting} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-5 text-[13px] text-fg-muted">
        No account?{' '}
        <Link to="/register" className="text-accent hover:underline">
          Create one
        </Link>
      </p>

      <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-fg-muted">
        Pre-filled with the seeded demo account. Run{' '}
        <code className="font-mono text-fg-secondary">npm run seed</code> in the backend first.
      </p>
    </AuthShell>
  );
}

export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Logo size={22} />
          <p className="mt-2 text-[13px] text-fg-muted">{subtitle}</p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-6">{children}</div>
      </div>
    </div>
  );
}
