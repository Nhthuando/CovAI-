import {
  GitBranch,
  FileCode2,
  BarChart3,
  ShieldCheck,
  Layers,
  GitPullRequest,
} from "lucide-react";
import Badge from "./common/Badge";
import Card from "./common/Card";

const FEATURES = [
  {
    id: "cfg-analysis",
    icon: GitBranch,
    title: "Control Flow Graph (CFG) Analysis",
    desc: "Parses Abstract Syntax Trees to construct directed execution graphs. Pinpoints dead code, complex conditional branches, and unreached decision paths.",
    tag: "Graph Engine",
  },
  {
    id: "test-synthesis",
    icon: FileCode2,
    title: "Automated Jest & Vitest Synthesis",
    desc: "AI models generate runnable test cases tailored directly to uncovered branch predicates with precise assertions and minimal boilerplate.",
    tag: "Test Generation",
  },
  {
    id: "coverage-metrics",
    icon: BarChart3,
    title: "Multi-Vector Coverage Diagnostics",
    desc: "Provides rigorous line-by-line coverage metrics for statements, branches, functions, and lines with full Istanbul and nyc compatibility.",
    tag: "Diagnostics",
  },
  {
    id: "sandbox-execution",
    icon: ShieldCheck,
    title: "Deterministic Sandbox Validation",
    desc: "Executes newly generated tests in an isolated Node.js sandbox runner before committing, verifying zero false positives or broken dependencies.",
    tag: "Sandbox Runner",
  },
  {
    id: "mock-generation",
    icon: Layers,
    title: "Dependency Mock & Fixture Synthesis",
    desc: "Constructs deterministic mocks for complex modules, HTTP API endpoints, database clients, and file system calls automatically.",
    tag: "Mock Engine",
  },
  {
    id: "git-integration",
    icon: GitPullRequest,
    title: "GitHub & CI/CD Pipeline Gates",
    desc: "Integrates with your git workflow. Automatically evaluates Pull Request coverage deltas and flags regressions before code merges to main.",
    tag: "Integrations",
  },
];

export default function Features() {
  return (
    <section
      id="features"
      className="py-20 md:py-28 bg-[var(--color-bg)] border-b border-[var(--color-border)]"
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <Badge variant="primary" size="md" className="mb-3" pill>
            PLATFORM CAPABILITIES
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tracking-tight mb-3">
            Engineered for Test Automation & Coverage Integrity
          </h2>
          <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
            Purpose-built developer tools designed to identify untested logic,
            prevent regressions, and eliminate manual test writing toil.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.id}
                id={`feature-${feature.id}`}
                className="p-6 flex flex-col justify-between hover:border-[var(--color-text-muted)] transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)]">
                      <Icon className="w-5 h-5" />
                    </div>
                    <Badge variant="outline" size="sm">
                      {feature.tag}
                    </Badge>
                  </div>

                  <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">
                    {feature.title}
                  </h3>

                  <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
