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
          ? err.fieldMessages[0] ?? err.message
          : 'Could not create the account. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Start scheduling precision emails in seconds.">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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

      <p className="mt-6 text-center text-sm text-slate-500">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-violet-400 hover:text-violet-300 transition-colors">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
