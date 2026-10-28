import { Sparkles, Terminal } from "lucide-react";
import Button from "../../common/Button.jsx";

export default function SystemTestZeroStateBanner({ onOpenGenerator }) {
  return (
    <div className="p-6 sm:p-8 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-start gap-3.5 max-w-2xl">
        <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] shrink-0 mt-0.5">
          <Terminal size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-[var(--color-text)]">
              No system tests yet
            </h4>

          </div>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed m-0">
            This project does not contain any Playwright or Cypress end-to-end test specs yet.
            Generate tests with the AI model selected in your chat. CovAI reads your source and checks generated tests before saving. Then run them to measure coverage and view results.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
        <Button
          variant="primary"
          size="sm"
          icon={Sparkles}
          onClick={onOpenGenerator}
          className="system-test-primary-action w-full md:w-auto font-medium"
        >
          Generate tests with AI
        </Button>
      </div>
    </div>
  );
}

