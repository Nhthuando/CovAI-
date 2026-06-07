import { Routes, Route } from "react-router-dom";
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

/* ── App Router ───────────────────────────────────────────── */
function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
    </Routes>
  );
}

export default App;
