import Navbar from "../Navbar";
import Footer from "../Footer";
import LandingHero from "./LandingHero";
import LandingCapabilities from "./LandingCapabilities";
import LandingCoverage from "./LandingCoverage";
import { LandingFaq, LandingPricing, LandingProof } from "./LandingSections";
import { LandingBento, LandingCta, LandingWorkflow } from "./LandingShowcase";
import "./landing.css";

/**
 * Marketing landing page ("/").
 * Hero (WebGL CFG) → proof → coverage levels → capability showcase (auto-advancing tabs)
 * → bento tiles → pipeline rail → pricing → FAQ → CTA.
 * Styles are scoped under `.lp` in landing.css.
 */
export default function LandingPage() {
  return (
    <div className="lp min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <LandingHero />
        <LandingProof />
        <LandingCoverage />
        <LandingCapabilities />
        <LandingBento />
        <LandingWorkflow />
        <LandingPricing />
        <LandingFaq />
        <LandingCta />
      </main>
      <Footer />
    </div>
  );
}
