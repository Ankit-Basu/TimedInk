import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import GoogleButton from '../components/GoogleButton';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import AuthLanding from './AuthLanding';

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

  useDocumentTitle('Sign in');

  if (user) return <Navigate to="/dashboard" replace />;

  // Send the user back where they were headed before the redirect.
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
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
    <AuthLanding
      defaultOpen
      card={
        <AuthCard title="Welcome back" subtitle="Sign in to your scheduling console.">
          <GoogleButton redirectTo={from} />
          <Divider />

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

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-ink-3">
            No account?{' '}
            <Link to="/register" className="font-medium text-ink underline decoration-white/25 underline-offset-4 hover:decoration-accent">
              Create one
            </Link>
          </p>

          <p className="mono mt-6 rounded-xl border border-edge bg-black/20 px-3.5 py-2.5 text-center text-[11px] leading-relaxed text-ink-3">
            Pre-filled with the seeded demo account · run <span className="text-ink-2">npm run seed</span>
          </p>
        </AuthCard>
      }
    />
  );
}

/** The glass card the hero holds — shared by sign in and registration. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="glass-strong ring-gradient rounded-[28px] p-7 sm:p-8 shadow-2xl">
      <h2 className="headline text-[2.1rem] pr-10">{title}</h2>
      <p className="mt-1.5 mb-7 text-[13.5px] text-ink-3">{subtitle}</p>
      {children}
    </div>
  );
}

export function Divider() {
  return (
    <div className="my-6 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
      <span className="label">or with email</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
    </div>
  );
}
