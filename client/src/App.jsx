/* eslint-disable no-unused-vars */
import { Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
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
import { NotificationProvider } from "./contexts/NotificationContext";
import { useAuth } from "./hooks/useAuth";

/* ── Landing Page ─────────────────────────────────────────── */
function LandingPage() {
  return (
    <div style={{ background: "var(--surface-main)", minHeight: "100vh" }}>
      <Navbar />
      <main>
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
        <Route path="/auth/github/callback" element={<GithubCallbackPage />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <NotificationProvider>
      <AppContent />
    </NotificationProvider>
  );
}

export default App;
