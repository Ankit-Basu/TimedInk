import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, tokenStore } from './api';
import type { AuthUser } from './types';

interface AuthState {
  user: AuthUser | null;
  /** True while we are validating a token found in storage on first paint. */
  initialising: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds the signed-in user.
 *
 * The JWT lives in localStorage. That is readable by any script on the page, so
 * an XSS becomes a session compromise — the trade-off is recorded in
 * ASSUMPTIONS.md, and the production answer is an httpOnly refresh cookie.
 *
 * On mount we call /api/auth/me rather than trusting the stored token blindly,
 * so an expired or revoked token lands the user on the login screen instead of
 * on a dashboard that 401s on every request.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialising, setInitialising] = useState(true);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setInitialising(false);
      return;
    }

    let cancelled = false;
    api
      .me()
      .then((result) => {
        if (!cancelled) setUser(result.user);
      })
      .catch(() => {
        // Expired, forged, or the API restarted with a different secret.
        tokenStore.clear();
      })
      .finally(() => {
        if (!cancelled) setInitialising(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    tokenStore.set(result.token);
    setUser(result.user);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const result = await api.register(email, password, name);
    tokenStore.set(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, initialising, login, register, logout }),
    [user, initialising, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
