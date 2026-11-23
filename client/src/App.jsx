/* eslint-disable no-unused-vars */
import { useEffect } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import Lenis from "lenis";
import "./index.css";
import "./components/landing/landing.css";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import IDEPreview from "./components/IDEPreview";
import Features from "./components/Features";
import Workflow from "./components/Workflow";
import Pricing from "./components/Pricing";
import Footer from "./components/Footer";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectSelectionPage from "./pages/ProjectSelectionPage";
import GithubCallbackPage from "./pages/GithubCallbackPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import IntegrationReportPage from "./pages/IntegrationReportPage";
import InvitationPage from "./pages/InvitationPage";
import LegalPage from "./pages/LegalPage";
import { NotificationProvider } from "./contexts/NotificationContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { RunningProcessProvider } from "./contexts/RunningProcessContext";
import { ToastProvider } from "./components/dashboard/ToastContext";
import GlobalProcessIndicator from "./components/GlobalProcessIndicator";
import FloatingJobQueue from "./components/FloatingJobQueue";
import { useAuth } from "./hooks/useAuth";
import GlobalErrorBoundary from "./components/common/GlobalErrorBoundary";

/* ── Landing Page ─────────────────────────────────────────── */
function LandingPage() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.05,
      smoothWheel: true,
      wheelMultiplier: 0.95,
    });
    let rafId;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="lp min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <IDEPreview />
        <Features />
        <Workflow />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}

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
        <Route path="/privacy" element={<LegalPage section="privacy" />} />
        <Route path="/terms" element={<LegalPage section="terms" />} />
        <Route path="/telemetry" element={<LegalPage section="telemetry" />} />
        <Route
          path="*"
          element={
            <main className="min-h-screen grid place-items-center bg-[var(--color-bg)] p-6 text-[var(--color-text)]">
              <div className="space-y-4 text-center">
                <h1 className="text-2xl font-semibold">404 - Page not found</h1>
                <Link to="/" className="text-[var(--color-primary)] underline">
                  Back to home
                </Link>
              </div>
            </main>
          }
        />
      </Routes>
      <GlobalProcessIndicator />
      <FloatingJobQueue />
    </>
  );
}

function App() {
  const { userId } = useAuth();
  return (
    <ThemeProvider>
      <NotificationProvider>
        <RunningProcessProvider
          key={userId || "anonymous"}
          sessionUserId={userId}
        >
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
