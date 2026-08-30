import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoadingState } from './components/ui';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';

/**
 * Gate for authenticated routes.
 *
 * While the stored token is being validated we render a spinner rather than
 * redirecting - otherwise a hard refresh would bounce a signed-in user to the
 * login screen for a frame before bouncing them back.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, initialising } = useAuth();

  if (initialising) return <LoadingState label="Restoring your session..." />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

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
