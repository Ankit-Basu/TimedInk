import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { loadGoogleIdentity } from '../lib/google';
import { useToast } from '../lib/toast';
import { Spinner } from './ui';

const GoogleMark = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/**
 * "Continue with Google".
 *
 * With a client id configured on the server this renders Google's own button
 * through Identity Services, then trades the returned ID token for our JWT at
 * POST /api/auth/google, where it is verified.
 *
 * Without one, a look-alike button explains what to configure instead of
 * failing silently — so the login page never shows a dead control.
 */
export default function GoogleButton({ redirectTo = '/dashboard' }: { redirectTo?: string }) {
  const { loginWithGoogle } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api.authConfig(), staleTime: Infinity });
  const clientId = config.data?.googleClientId ?? null;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    loadGoogleIdentity()
      .then((gis) => {
        if (cancelled || !hostRef.current) return;
        gis.initialize({
          client_id: clientId,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
          callback: ({ credential }) => {
            setSigningIn(true);
            loginWithGoogle(credential)
              .then(() => navigate(redirectTo, { replace: true }))
              .catch((err: unknown) =>
                showToast(
                  'error',
                  'Google sign-in failed',
                  err instanceof ApiError ? err.message : 'Please try again.',
                ),
              )
              .finally(() => setSigningIn(false));
          },
        });
        const width = Math.round(hostRef.current.getBoundingClientRect().width) || 360;
        gis.renderButton(hostRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: Math.min(400, width),
        });
        setReady(true);
      })
      .catch((err: unknown) =>
        showToast('error', 'Google sign-in unavailable', err instanceof Error ? err.message : undefined),
      );

    return () => {
      cancelled = true;
    };
  }, [clientId, loginWithGoogle, navigate, redirectTo, showToast]);

  const explainSetup = () =>
    showToast(
      'info',
      'Google sign-in is not configured',
      'Set GOOGLE_CLIENT_ID in backend/.env and restart the API. The demo account below works meanwhile.',
      7000,
    );

  if (clientId) {
    return (
      <div className="relative flex min-h-12 items-center justify-center">
        {/* Google's own button — required by its branding terms, and it is what
            gets the popup past blockers. filled_black sits well on dark glass. */}
        <div ref={hostRef} className="flex w-full justify-center [color-scheme:light]" />
        {(!ready || signingIn) && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 rounded-full border border-edge-strong bg-white/[0.08] text-sm text-ink backdrop-blur-md">
            {signingIn ? <Spinner className="h-4 w-4" /> : <GoogleMark />}
            {signingIn ? 'Signing you in…' : 'Loading Google…'}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={explainSetup}
      className="group flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-edge-strong
        bg-white/[0.08] text-sm font-medium text-ink backdrop-blur-md transition-all duration-300
        hover:border-white/30 hover:bg-white/[0.13] hover:shadow-[0_8px_30px_-8px_rgb(255_255_255/0.25)]"
    >
      <GoogleMark />
      Continue with Google
    </button>
  );
}
