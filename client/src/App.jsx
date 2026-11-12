/* eslint-disable no-unused-vars */
import { Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import LandingPage from "./components/landing/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectSelectionPage from "./pages/ProjectSelectionPage";
import GithubCallbackPage from "./pages/GithubCallbackPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import IntegrationReportPage from "./pages/IntegrationReportPage";
import InvitationPage from "./pages/InvitationPage";
import { NotificationProvider } from "./contexts/NotificationContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { RunningProcessProvider } from "./contexts/RunningProcessContext";
import { ToastProvider } from "./components/dashboard/ToastContext";
import GlobalProcessIndicator from "./components/GlobalProcessIndicator";
import { useAuth } from "./hooks/useAuth";
import GlobalErrorBoundary from "./components/common/GlobalErrorBoundary";

/* ── Protected Route ────────────────────────────────────────── */
function ProtectedRoute({ children }) {
  const token =
    localStorage.getItem("token") ||
    (localStorage.getItem("user")
      ? JSON.parse(localStorage.getItem("user")).token
      : null);
  if (!token) {
    return <Navigate to="/" replace />;
  }
  return children;
}

/* ── Redirect if Authenticated ─────────────────────────────── */
function RedirectIfAuthenticated({ children }) {
  const token =
    localStorage.getItem("token") ||
    (localStorage.getItem("user")
      ? JSON.parse(localStorage.getItem("user")).token
      : null);
  if (token) {
    return <Navigate to="/projects" replace />;
  }
  return children;
}

/* ── App Router ───────────────────────────────────────────── */
function AppContent() {
  const { userId } = useAuth();

  return (
    <>
      <Routes>
        <Route path="/invitations/:token" element={<InvitationPage />} />
        <Route
          path="/"
          element={
            <RedirectIfAuthenticated>
              <LandingPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuthenticated>
              <RegisterPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/reset-password"
          element={
            <RedirectIfAuthenticated>
              <ResetPasswordPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <ProjectSelectionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/main-editor"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/editor"
          element={<Navigate to="/main-editor" replace />}
        />
        <Route
          path="/project/:projectId/reports/integration"
          element={
            <ProtectedRoute>
              <IntegrationReportPage />
            </ProtectedRoute>
          }
        />
        <Route path="/auth/github/callback" element={<GithubCallbackPage />} />
      </Routes>
      <GlobalProcessIndicator />
    </>
  );
}

function App() {
  const { userId } = useAuth();
  return (
    <ThemeProvider>
      <NotificationProvider>
        <RunningProcessProvider key={userId || "anonymous"} sessionUserId={userId}>
          <ToastProvider>
            <GlobalErrorBoundary>
              <AppContent />
            </GlobalErrorBoundary>
          </ToastProvider>
        </RunningProcessProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

export default App;
