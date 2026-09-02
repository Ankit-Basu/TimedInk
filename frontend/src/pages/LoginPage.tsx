import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import Logo from '../components/Logo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

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
    <AuthShell
      eyebrow="Sign in"
      headline={
        <>
          Write it now.
          <br />
          <span className="text-ink-3 italic">Send it</span> exactly when
          <br />
          you meant to.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-7" noValidate>
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

      <p className="mt-8 text-[13px] text-ink-2">
        No account?{' '}
        <Link to="/register" className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
          Create one
        </Link>
      </p>

      <p className="mt-8 border-t border-rule pt-5 text-xs leading-relaxed text-ink-3">
        Pre-filled with the seeded demo account. Run{' '}
        <code className="mono text-ink-2">npm run seed</code> in the backend first.
      </p>
    </AuthShell>
  );
}

/**
 * Two-column editorial split: the argument on the left, the form on the right.
 * Below `lg` it stacks and the display column shrinks to just the wordmark.
 */
export function AuthShell({
  eyebrow,
  headline,
  children,
}: {
  eyebrow: string;
  headline: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full p-3 sm:p-5">
      <div className="frame grid min-h-[calc(100vh-1.5rem)] grid-cols-1 sm:min-h-[calc(100vh-2.5rem)] lg:grid-cols-2">
        {/* Display column */}
        <div className="flex flex-col justify-between gap-12 border-b border-rule p-8 sm:p-12 lg:border-r lg:border-b-0">
          <Logo />

          <h1 className="display max-w-xl text-[2.75rem] leading-[1.05] sm:text-6xl">{headline}</h1>

          <div className="label hidden gap-6 lg:flex">
            <span>Scheduled send</span>
            <span>Warmup limits</span>
            <span>Open tracking</span>
          </div>
        </div>

        {/* Form column */}
        <main className="flex items-center justify-center p-8 sm:p-12">
          <div className="w-full max-w-sm">
            <p className="label mb-8">{eyebrow}</p>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
