import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';

/**
 * Gate for authenticated routes.
 *
 * While the stored token is being validated we hold rather than redirect —
 * otherwise a hard refresh would bounce a signed-in user to the login screen
 * for a frame before bouncing them back.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initialising } = useAuth();
  // Router state, not window.location, so the redirect target stays correct
  // under a basename or a future memory/hash router.
  const location = useLocation();

  if (initialising) {
    return (
      <div className="flex min-h-full items-center justify-center gap-2.5 text-[13px] text-ink-3">
        <Spinner className="h-4 w-4" />
        Restoring your session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
