import "./index.css";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import IDEPreview from "./components/IDEPreview";
import Features from "./components/Features";
import Workflow from "./components/Workflow";
import Pricing from "./components/Pricing";
import Footer from "./components/Footer";

function App() {
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

export default App;
