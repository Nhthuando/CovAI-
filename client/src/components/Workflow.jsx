import { Link } from "react-router-dom";
import {
  FolderGit2,
  Network,
  FileCode,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import Card from "./common/Card";

const STEPS = [
  {
    num: "01",
    icon: FolderGit2,
    title: "Repository Ingestion",
    desc: "Import code directly from GitHub or upload a local archive. CovAI parses project ASTs, configs, and dependencies.",
  },
  {
    num: "02",
    icon: Network,
    title: "Control Flow Analysis",
    desc: "Constructs Control Flow Graphs (CFG) per function to discover uncovered branch predicates and evaluate cyclomatic complexity.",
  },
  {
    num: "03",
    icon: FileCode,
    title: "Test Suite Synthesis",
    desc: "Targeted Jest and Vitest suites are synthesized with accurate mocks and assertions designed specifically for uncovered paths.",
  },
  {
    num: "04",
    icon: CheckCircle2,
    title: "Sandbox Verification",
    desc: "Executes the synthesized tests in an isolated Node.js test runner to ensure tests pass and measurably boost coverage.",
  },
];

export default function Workflow() {
  return (
    <section
      id="workflow"
      className="py-20 md:py-28 bg-[var(--color-surface)] border-b border-[var(--color-border)]"
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <Badge variant="primary" size="md" className="mb-3" pill>
            EXECUTION PIPELINE
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tracking-tight mb-3">
            How CovAI Analyzes and Tests Code
          </h2>
          <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
            A deterministic four-stage engineering pipeline designed for
            accuracy, repeatability, and immediate developer adoption.
          </p>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <Card
                key={step.num}
                id={`workflow-step-${step.num}`}
                className="p-5 flex flex-col justify-between bg-[var(--color-bg)] border-[var(--color-border)]"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-mono text-xs font-bold text-[var(--color-primary)] px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                      STAGE {step.num}
                    </span>
                    <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] flex items-center justify-center text-[var(--color-text)] border border-[var(--color-border)]">
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">
                    {step.title}
                  </h3>

                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Bottom Action */}
        <div className="mt-12 text-center">
          <Button
            as={Link}
            to="/register"
            id="workflow-cta"
            variant="secondary"
            size="md"
            icon={ArrowRight}
            iconPosition="right"
          >
            Deploy Pipeline to Your Repository
          </Button>
        </div>
      </div>
    </section>
  );
}
