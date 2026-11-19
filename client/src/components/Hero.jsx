import { useState, Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Copy, Check } from "lucide-react";
import TechMarquee from "./landing/TechMarquee";

const CfgWebGLCore = lazy(() => import("./landing/CfgWebGLCore"));

const PRESET_REPOS = [
  {
    repo: "acme/payment-kernel",
    before: "58.3%",
    after: "98.4%",
    branchesFixed: 5,
    duration: "1.42s",
  },
  {
    repo: "stripe-labs/webhook-router",
    before: "61.0%",
    after: "97.8%",
    branchesFixed: 8,
    duration: "1.68s",
  },
  {
    repo: "nexus/session-authority",
    before: "49.5%",
    after: "96.9%",
    branchesFixed: 11,
    duration: "1.94s",
  },
];

export default function Hero() {
  const [repoInput, setRepoInput] = useState(PRESET_REPOS[0].repo);
  const [scanPulse, setScanPulse] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(PRESET_REPOS[0]);
  const [copied, setCopied] = useState(false);

  const cliCommand = "npx covai-cli analyze --tier=all";

  const handleCopy = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSimulateScan = (e) => {
    if (e) e.preventDefault();
    setIsScanning(true);
    setScanPulse((p) => p + 1);

    const matched = PRESET_REPOS.find((r) =>
      repoInput.toLowerCase().includes(r.repo.split("/")[1]),
    ) || {
      repo: repoInput || "org/repository",
      before: "54.2%",
      after: "97.6%",
      branchesFixed: 7,
      duration: "1.51s",
    };

    setTimeout(() => {
      setIsScanning(false);
      setScanResult(matched);
    }, 550);
  };

  return (
    <>
      <section
        id="hero"
        className="relative pt-28 pb-16 md:pt-36 md:pb-24 overflow-hidden"
      >
        {/* Subtle Architectural Grid */}
        <div className="absolute inset-0 lp-draft-grid lp-radial-fade pointer-events-none" />
        <div
          className="absolute -top-48 left-1/2 -translate-x-1/2 w-[920px] h-[460px] rounded-full pointer-events-none blur-[150px] opacity-25"
          style={{
            background:
              "radial-gradient(circle, rgba(56,189,248,0.45) 0%, transparent 70%)",
          }}
        />

        <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-9 items-center">
            {/* Left Column: Editorial Technical Typography & Live Repo Probe (7 cols) */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-7 text-left space-y-6"
            >
              <div className="inline-flex items-center gap-2.5 text-xs lp-mono text-slate-400">
                <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
                <span>
                  Static AST graph analysis &amp; container-verified test
                  generation
                </span>
              </div>

              <h1 className="lp-display text-4xl sm:text-5xl xl:text-[58px] font-bold tracking-tight leading-[1.07] text-[#f1f5f9] max-w-[18ch]">
                Map every untested branch. Ship verified tests in seconds.
              </h1>

              <p className="text-base sm:text-lg text-slate-400 leading-relaxed max-w-[60ch]">
                CovAI parses your source tree into a directed Control Flow
                Graph, pinpoints decision predicates with zero execution hits,
                and writes unit, API contract, and Playwright suites validated
                inside an isolated Docker container.
              </p>

              {/* Interactive Repository Scan Simulator */}
              <div className="p-3 rounded-xl lp-machined max-w-2xl">
                <form
                  onSubmit={handleSimulateScan}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-[#050608] border border-[#1a1f2c] focus-within:border-[#38bdf8] transition-colors">
                    <span className="text-xs lp-mono text-slate-500 select-none">
                      github.com/
                    </span>
                    <input
                      type="text"
                      value={repoInput}
                      onChange={(e) => setRepoInput(e.target.value)}
                      aria-label="Repository path to simulate CFG scan"
                      placeholder="org/repository"
                      className="w-full bg-transparent text-xs sm:text-sm lp-mono text-slate-100 placeholder-slate-600 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="lp-btn-primary px-5 py-2.5 rounded-lg text-xs sm:text-sm cursor-pointer shrink-0"
                  >
                    {isScanning ? "Traversing AST..." : "Simulate CFG scan"}
                  </button>
                </form>

                <div className="mt-3 px-1 flex flex-wrap items-center justify-between gap-2 text-xs lp-mono">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-slate-500">Sample targets:</span>
                    {PRESET_REPOS.map((item) => (
                      <button
                        key={item.repo}
                        type="button"
                        onClick={() => {
                          setRepoInput(item.repo);
                          setScanResult(item);
                          setScanPulse((p) => p + 1);
                        }}
                        className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                          repoInput === item.repo
                            ? "bg-white/[0.08] border-slate-500 text-white"
                            : "bg-transparent border-[#181c26] text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {item.repo}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-[#f43f5e]">{scanResult.before}</span>
                    <span className="text-slate-600">/</span>
                    <span className="text-[#38bdf8] font-semibold">
                      {scanResult.after}
                    </span>
                    <span className="text-slate-500">
                      ({scanResult.branchesFixed} branches resolved in{" "}
                      {scanResult.duration})
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Row */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to="/register"
                  id="hero-cta-btn"
                  className="lp-btn-primary px-6 py-3 rounded-lg text-sm inline-flex items-center"
                >
                  Connect repository
                </Link>

                <a
                  href="#ide-preview"
                  className="lp-btn-secondary px-5 py-3 rounded-lg text-sm font-medium inline-flex items-center"
                >
                  Inspect live code sandbox
                </a>

                <div className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-[#080a0f] border border-[#181c26] text-xs lp-mono">
                  <span className="text-slate-500 select-none">$</span>
                  <code className="text-slate-300 select-all">
                    {cliCommand}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label="Copy CLI command"
                    className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-[#38bdf8]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Clean Structural Telemetry Readout */}
              <div className="pt-5 grid grid-cols-3 gap-6 max-w-lg border-t border-[#161a24]">
                <div>
                  <div className="text-xl sm:text-2xl font-bold lp-mono text-white">
                    96.4%
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Branch coverage target
                  </div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-bold lp-mono text-white">
                    1.4s
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Median AST graph build
                  </div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-bold lp-mono text-white">
                    0 flaky
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Container-verified specs
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Right Column: Interactive 3D WebGL AST & CFG Core (5 cols) */}
            <div className="lg:col-span-5">
              <Suspense
                fallback={
                  <div className="w-full h-[500px] rounded-xl lp-machined flex items-center justify-center text-xs lp-mono text-slate-500">
                    Loading 3D Control Flow Graph...
                  </div>
                }
              >
                <CfgWebGLCore
                  scanPulse={scanPulse}
                  repoName={repoInput || "acme/payment-kernel"}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      <TechMarquee />
    </>
  );
}
