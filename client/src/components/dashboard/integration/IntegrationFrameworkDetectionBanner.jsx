import React, { useState } from "react";
import {
  Sparkles,
  DownloadCloud,
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  PackageOpen,
  ArrowRight,
  Info,
  Layers,
  Zap,
} from "lucide-react";

export default function IntegrationFrameworkDetectionBanner({
  detectionInfo,
  onGenerateTests,
  onInstallDependencies,
  isInstalling = false,
  isGenerating = false,
}) {
  const selectedFramework = "supertest";
  const [showInstallModal, setShowInstallModal] = useState(false);

  if (!detectionInfo) return null;

  const {
    framework,
    isZeroTestProject,
    needsDependencyInstall,
    permutationDetails,
  } = detectionInfo;

  const missingPackages = permutationDetails?.missingPackages || [
    "supertest",
    "jest",
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Missing Dependencies Alert Modal / Banner */}
      {needsDependencyInstall && (
        <div className="rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 p-4 text-[var(--color-text)] shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-amber-500/20 p-1.5 text-amber-500">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-500 m-0 flex items-center gap-2">
                  <span>Test Files Detected Missing Dependencies</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 font-semibold uppercase">
                    Scenario D
                  </span>
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Project contains API test files (inferred framework:{" "}
                  <strong className="text-[var(--color-text)] font-semibold font-mono">
                    {framework?.toUpperCase() || "SUPERTEST"}
                  </strong>
                  ), but required runner packages are missing from <code className="text-amber-400 font-mono">package.json</code>.
                </p>

                {/* List missing packages */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[var(--color-text-muted)] font-medium">Required packages:</span>
                  {missingPackages.map((pkg) => (
                    <span
                      key={pkg}
                      className="px-2 py-0.5 rounded bg-[var(--color-surface)] border border-amber-500/30 font-mono text-[11px] font-semibold text-amber-400 flex items-center gap-1 shadow-xs"
                    >
                      <PackageOpen size={12} />
                      {pkg}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onInstallDependencies && onInstallDependencies()}
                disabled={isInstalling}
                className="flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-md)] bg-amber-500 hover:bg-amber-600 text-black text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
              >
                <DownloadCloud size={14} className={isInstalling ? "animate-bounce" : ""} />
                <span>{isInstalling ? "Installing packages..." : "Install Packages & Continue Analysis"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Zero-Test Project Banner (No test files in repository) */}
      {isZeroTestProject && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-4 text-[var(--color-text)] shadow-xs">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]/60">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-[var(--color-primary)]/20 p-1.5 text-[var(--color-primary)]">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--color-primary)] m-0 flex items-center gap-2">
                    <span>Zero Integration Tests Found</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-primary)]/20 border border-[var(--color-primary)]/30 font-semibold uppercase">
                      Cold-Start AI
                    </span>
                  </h4>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    No API test files found in repository. AI will analyze AST router/controller endpoints and synthesize full Supertest + Jest coverage scenarios.
                  </p>
                </div>
              </div>
            </div>

            {/* Framework Info & AI CTA */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-text)] shadow-xs font-semibold select-none">
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <span>Supertest + Jest</span>
                      <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono">
                        Active Runner
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 font-normal">
                      In-memory Express HTTP server verification &amp; Istanbul coverage
                    </div>
                  </div>
                </div>
              </div>

              {/* Generate AI CTA Button */}
              <button
                type="button"
                onClick={() => onGenerateTests && onGenerateTests(selectedFramework)}
                disabled={isGenerating}
                className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-bold hover:opacity-90 transition-all shadow-md cursor-pointer disabled:opacity-50"
              >
                <Sparkles size={14} className={isGenerating ? "animate-spin text-amber-300" : ""} />
                <span>
                  {isGenerating
                    ? "Analyzing AST & Generating Tests..."
                    : "✨ Auto-generate API Test Scenarios with AI"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
