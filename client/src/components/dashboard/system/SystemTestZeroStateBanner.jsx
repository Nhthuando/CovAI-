import { Sparkles, Terminal } from "lucide-react";
import Button from "../../common/Button.jsx";

export default function SystemTestZeroStateBanner({ onOpenGenerator }) {
  return (
    <div className="p-5 mb-6 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-start gap-3.5 max-w-2xl">
        <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] shrink-0 mt-0.5">
          <Terminal size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-[var(--color-text)]">
              No System Test Files Detected
            </h4>
            <span className="text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/30 font-medium">
              Zero-Test Project
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed m-0">
            This project does not contain any Playwright or Cypress end-to-end test specs yet.
            CovAI can crawl your application routes, discover interactive forms and buttons, and automatically generate cold-start system test suites.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
        <Button
          variant="primary"
          size="sm"
          icon={Sparkles}
          onClick={onOpenGenerator}
          className="w-full md:w-auto font-medium"
        >
          Auto-Generate Tests with AI
        </Button>
      </div>
    </div>
  );
}

