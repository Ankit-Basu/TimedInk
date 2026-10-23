import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import GoogleButton from '../components/GoogleButton';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import AuthLanding from './AuthLanding';
import { AuthCard, Divider } from './LoginPage';

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useDocumentTitle('Create account');

  if (user) return <Navigate to="/dashboard" replace />;

  // Mirrors the server-side zod rule, so the user finds out before a round trip.
  const passwordTooShort = password.length > 0 && password.length < 8;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordTooShort) return;

    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, name);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.fieldMessages[0] ?? err.message)
          : 'Could not create the account. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLanding
      defaultOpen
      card={
        <AuthCard title="Create your account" subtitle="Start scheduling in under a minute.">
          <GoogleButton />
          <Divider />

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error && <Alert>{error}</Alert>}

            <Field label="Name" required>
              <Input
                name="name"
                autoComplete="name"
                required
                placeholder="Ava Patel"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="Email" required>
              <Input
                type="email"
                name="email"
                autoComplete="username"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field
              label="Password"
              required
              hint="At least 8 characters."
              error={passwordTooShort ? 'Password must be at least 8 characters.' : undefined}
            >
              <Input
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Button type="submit" size="lg" loading={submitting} disabled={passwordTooShort} className="w-full">
              Create account
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-ink-3">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-ink underline decoration-white/25 underline-offset-4 hover:decoration-accent">
              Sign in
            </Link>
          </p>
        </AuthCard>
      }
    />
  );
}
