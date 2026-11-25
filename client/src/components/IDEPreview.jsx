import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  Play,
  RotateCcw,
  FileCode2,
  FlaskConical,
  Network,
  BarChart3,
  Layers,
  GitBranch,
  MessageSquare,
  ShieldCheck,
  ArrowUpRight,
  Sparkles,
  Pause,
} from "lucide-react";
import CovaiLogo from "./common/CovaiLogo";
import {
  EditorExplorerSidebar,
  ScreenEditorView,
  ScreenUnitMatrixView,
  ScreenIntegrationFlowView,
  ScreenReportQueueView,
} from "./landing/StudioScreenViews";

const STUDIO_SCREENS = [
  {
    id: "editor",
    label: "Code & AST Gutters",
    workspaceTab: "unit",
    icon: FileCode2,
    caption: "Line-level coverage markers + live AST tree",
    metricLabel: "Branch coverage",
    metricBefore: "58.3%",
    metricAfter: "98.4%",
  },
  {
    id: "unit",
    label: "Unit Test Matrix",
    workspaceTab: "unit",
    icon: FlaskConical,
    caption: "File coverage metrics, assertions & AI repair",
    metricLabel: "Suite pass rate",
    metricBefore: "120/122",
    metricAfter: "122/122",
  },
  {
    id: "integration",
    label: "Integration Flow Studio",
    workspaceTab: "integration",
    icon: Network,
    caption: "Animated request lifecycle & contract assertions",
    metricLabel: "API contracts",
    metricBefore: "HTTP 200",
    metricAfter: "13/13 pass",
  },
  {
    id: "report",
    label: "Quality Report & Queue",
    workspaceTab: "system",
    icon: BarChart3,
    caption: "Executive PDF export & background job queue",
    metricLabel: "Quality score",
    metricBefore: "Grade A",
    metricAfter: "94 / 100",
  },
];

export default function IDEPreview() {
  const [activeId, setActiveId] = useState("editor");
  const [healed, setHealed] = useState(true);
  const [autoPlay, setAutoPlay] = useState(true);
  const stageRef = useRef(null);

  // Smooth 3D mouse-tracking tilt springs
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const smoothX = useSpring(mouseX, { stiffness: 130, damping: 22 });
  const smoothY = useSpring(mouseY, { stiffness: 130, damping: 22 });
  const rotateY = useTransform(smoothX, [-0.5, 0.5], [-6, 6]);
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [4.5, -4.5]);

  useEffect(() => {
    if (!autoPlay) return undefined;
    const timer = setInterval(() => {
      setActiveId((prev) => {
        const idx = STUDIO_SCREENS.findIndex((s) => s.id === prev);
        return STUDIO_SCREENS[(idx + 1) % STUDIO_SCREENS.length].id;
      });
    }, 5200);
    return () => clearInterval(timer);
  }, [autoPlay]);

  const handleMouseMove = (e) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    mouseX.set(nx);
    mouseY.set(ny);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  const activeScreen =
    STUDIO_SCREENS.find((s) => s.id === activeId) || STUDIO_SCREENS[0];

  return (
    <section
      id="ide-preview"
      className="relative py-24 md:py-32 border-b border-[var(--lp-line)] overflow-hidden bg-[#050608]"
    >
      {/* Dark Atmospheric Graphic Layers */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[960px] h-[440px] rounded-full blur-[150px] opacity-20"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(56, 189, 248, 0.45), rgba(99, 102, 241, 0.18) 45%, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-72 lp-floor-grid opacity-55"
      />

      <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6">
        {/* Concise Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
          <div className="space-y-2 max-w-xl">
            <h2 className="lp-display text-3xl sm:text-4xl font-bold text-[var(--lp-ink)] tracking-tight">
              Inside CovAI Studio
            </h2>
            <p className="text-sm sm:text-base text-[var(--lp-ink-secondary)]">
              Explore the post-login workspace: coverage gutters, test matrices,
              API flow traces, and quality reports.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setAutoPlay((v) => !v)}
              className="px-3.5 py-2 rounded-lg lp-btn-secondary text-xs lp-mono inline-flex items-center gap-1.5 cursor-pointer"
            >
              {autoPlay ? (
                <>
                  <Pause className="w-3.5 h-3.5 text-[var(--lp-signal)]" />
                  <span>Auto-tour on</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Auto-tour paused</span>
                </>
              )}
            </button>

            {activeId === "editor" && (
              <button
                type="button"
                onClick={() => {
                  setAutoPlay(false);
                  setHealed((v) => !v);
                }}
                className="lp-btn-primary px-4 py-2 rounded-lg text-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                {healed ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Show fault lines</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Verify branches</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* 3D Interactive Workspace Stage */}
        <div
          ref={stageRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="lp-stage-perspective relative py-4"
        >
          <motion.div
            style={{ rotateX, rotateY }}
            className="lp-preserve-3d relative mx-auto max-w-[1140px]"
          >
            {/* Floating 3D Parallax Telemetry Card (Top-Right Foreground) */}
            <div className="hidden xl:flex lp-z-float-lg absolute -top-5 -right-5 z-30 items-center gap-3 px-4 py-2.5 rounded-lg bg-[#0d0e13]/95 border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-70" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-400" />
              </span>
              <div className="lp-mono">
                <div className="text-[10px] text-zinc-400">
                  {activeScreen.metricLabel}
                </div>
                <div className="text-xs font-bold text-zinc-100">
                  {activeId === "editor" && !healed
                    ? activeScreen.metricBefore
                    : activeScreen.metricAfter}
                </div>
              </div>
            </div>

            {/* Floating 3D Parallax Card (Bottom-Left Foreground) */}
            <div className="hidden xl:flex lp-z-float-md absolute -bottom-5 -left-5 z-30 items-center gap-2.5 px-3.5 py-2 rounded-lg bg-[#0d0e13]/95 border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md text-xs lp-mono text-zinc-200">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Isolated Docker Runner · 0 flaky</span>
            </div>

            {/* Main Studio Window Frame */}
            <div className="relative rounded-xl lp-beam-frame bg-[#090a0d] border border-white/[0.12] shadow-[0_36px_90px_-20px_rgba(0,0,0,0.95)] overflow-hidden">
              {/* Subtle animated holographic scan sweep */}
              <div
                aria-hidden="true"
                className="lp-scan-sweep pointer-events-none absolute inset-x-0 top-0 h-20 z-20"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent, rgba(56, 189, 248, 0.06), transparent)",
                }}
              />

              {/* Authentic Post-Login Global Studio Header */}
              <div className="px-4 h-11 border-b border-white/[0.08] bg-[#0e0f13] flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CovaiLogo size={20} />
                  <span className="font-semibold text-zinc-100 hidden sm:inline">
                    CovAI Studio
                  </span>
                  <span className="text-zinc-600 hidden sm:inline">/</span>
                  <span className="lp-mono text-[11px] text-zinc-400 truncate">
                    Projects / payment-kernel
                  </span>
                  <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-[10px] lp-mono text-zinc-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Engine Ready
                  </span>
                </div>

                {/* Top Center Workspace Switcher */}
                <div className="hidden md:flex items-center gap-1 p-0.5 rounded-md bg-[#090a0d] border border-white/[0.08]">
                  {[
                    { id: "unit", label: "Unit Test", icon: FlaskConical },
                    {
                      id: "integration",
                      label: "Integration Test",
                      icon: Network,
                    },
                    { id: "system", label: "System Test", icon: Layers },
                  ].map((tab) => {
                    const TabIcon = tab.icon;
                    const active = activeScreen.workspaceTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setAutoPlay(false);
                          setActiveId(
                            tab.id === "unit"
                              ? "unit"
                              : tab.id === "integration"
                                ? "integration"
                                : "report",
                          );
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          active
                            ? "bg-white/[0.1] text-zinc-100 font-medium"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        <TabIcon className="w-3 h-3" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/[0.08] bg-white/[0.03] text-[11px] text-zinc-300">
                    <MessageSquare className="w-3 h-3 text-sky-400" />
                    <span>AI Assistant</span>
                  </span>
                </div>
              </div>

              {/* Studio Body: Activity Rail + Explorer + Active Viewport */}
              <div className="flex min-h-[360px]">
                {/* Left Activity Rail */}
                <div className="hidden sm:flex flex-col items-center py-3 gap-3 w-11 shrink-0 border-r border-white/[0.07] bg-[#0b0c10]">
                  {STUDIO_SCREENS.map((item) => {
                    const RailIcon = item.icon;
                    const active = activeId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setAutoPlay(false);
                          setActiveId(item.id);
                        }}
                        title={item.label}
                        aria-label={item.label}
                        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                          active
                            ? "bg-white/[0.1] text-sky-400 border border-white/[0.14]"
                            : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
                        }`}
                      >
                        <RailIcon className="w-4 h-4" />
                      </button>
                    );
                  })}
                  <div className="mt-auto">
                    <GitBranch className="w-3.5 h-3.5 text-zinc-600" />
                  </div>
                </div>

                {/* Explorer Sidebar */}
                <EditorExplorerSidebar activeScreen={activeId} />

                {/* Main Animated Screen Canvas */}
                <div className="flex-1 min-w-0 relative overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${activeId}-${healed}`}
                      initial={{ opacity: 0, y: 8, scale: 0.99 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.99 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="h-full"
                    >
                      {activeId === "editor" && (
                        <ScreenEditorView healed={healed} />
                      )}
                      {activeId === "unit" && <ScreenUnitMatrixView />}
                      {activeId === "integration" && (
                        <ScreenIntegrationFlowView />
                      )}
                      {activeId === "report" && <ScreenReportQueueView />}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* 3D Perspective Screen Switcher Cards */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {STUDIO_SCREENS.map((screen) => {
            const Icon = screen.icon;
            const active = activeId === screen.id;
            return (
              <button
                key={screen.id}
                type="button"
                onClick={() => {
                  setAutoPlay(false);
                  setActiveId(screen.id);
                }}
                className={`group text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                  active
                    ? "bg-[#12141b] border-sky-400/45 shadow-[0_12px_32px_-12px_rgba(56,189,248,0.28)] -translate-y-0.5"
                    : "bg-[#0b0c10] border-[var(--lp-line)] hover:border-[var(--lp-line-strong)] hover:-translate-y-0.5"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
                      active
                        ? "bg-sky-500/10 border-sky-400/30 text-sky-400"
                        : "bg-white/[0.03] border-white/[0.08] text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[11px] lp-mono text-zinc-400">
                    {screen.metricAfter}
                  </span>
                </div>
                <div className="text-sm font-semibold text-zinc-100">
                  {screen.label}
                </div>
                <div className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {screen.caption}
                </div>
              </button>
            );
          })}
        </div>

        {/* Bottom Workspace CTA */}
        <div className="mt-8 flex justify-center">
          <Link
            to="/register"
            className="inline-flex items-center gap-1.5 text-xs lp-mono text-zinc-400 hover:text-sky-400 transition-colors"
          >
            <span>Open interactive workspace on your repository</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
