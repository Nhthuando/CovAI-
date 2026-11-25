import React, { useState } from "react";
import {
  Terminal,
  DownloadCloud,
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  PackageOpen,
  ArrowRight,
  Info,
  Layers,
  Play,
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
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-1.5 text-[var(--color-text-secondary)]">
                <AlertTriangle size={16} />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[var(--color-text)] m-0 flex items-center gap-2">
                  <span>Test Files Detected Missing Dependencies</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] uppercase">
                    Scenario D
                  </span>
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Project contains API test files (inferred framework:{" "}
                  <strong className="text-[var(--color-text)] font-semibold font-mono">
                    {framework?.toUpperCase() || "SUPERTEST"}
                  </strong>
                  ), but required runner packages are missing from <code className="text-[var(--color-text)] font-mono">package.json</code>.
                </p>

                {/* List missing packages */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[var(--color-text-muted)] font-medium">Required packages:</span>
                  {missingPackages.map((pkg) => (
                    <span
                      key={pkg}
                      className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-[11px] font-medium text-[var(--color-text-secondary)] flex items-center gap-1"
                    >
                      <PackageOpen size={12} className="text-[var(--color-text-muted)]" />
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
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-[var(--color-text)] text-[var(--color-bg)] hover:opacity-90 text-xs font-semibold transition-all duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
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
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-[var(--color-border)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-1.5 text-[var(--color-text-secondary)]">
                  <Terminal size={16} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[var(--color-text)] m-0 flex items-center gap-2">
                    <span>Zero Integration Tests Found</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] font-medium uppercase">
                      Cold-Start
                    </span>
                  </h4>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    No API test files found in repository. Analyze AST router/controller endpoints and synthesize Supertest + Jest coverage scenarios.
                  </p>
                </div>
              </div>
            </div>

            {/* Framework Info & CTA */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-semibold select-none">
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <span>Supertest + Jest</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-[var(--color-bg)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-mono">
                        Active Runner
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 font-normal">
                      In-memory Express HTTP server verification &amp; Istanbul coverage
                    </div>
                  </div>
                </div>
              </div>

              {/* Generate CTA Button */}
              <button
                type="button"
                onClick={() => onGenerateTests && onGenerateTests(selectedFramework)}
                disabled={isGenerating}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-text)] text-[var(--color-bg)] text-xs font-semibold hover:opacity-90 transition-all duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
              >
                <Play size={12} fill="currentColor" className={isGenerating ? "animate-pulse" : ""} />
                <span>
                  {isGenerating
                    ? "Analyzing AST & Generating Tests..."
                    : "Auto-generate API Test Scenarios"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
