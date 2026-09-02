import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import { AuthShell } from './LoginPage';

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <AuthShell
      eyebrow="Create account"
      headline={
        <>
          Every email,
          <br />
          <span className="text-ink-3 italic">out the door</span>
          <br />
          on time.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-7" noValidate>
        {error && <Alert>{error}</Alert>}

        <Field label="Name" required>
          <Input
            name="name"
            autoComplete="name"
            required
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

        <Button type="submit" loading={submitting} disabled={passwordTooShort} className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-8 text-[13px] text-ink-2">
        Already registered?{' '}
        <Link
          to="/login"
          className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
