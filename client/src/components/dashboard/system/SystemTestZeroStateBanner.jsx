import { FlaskConical, FileCode2 } from 'lucide-react';
import Button from '../../common/Button.jsx';

export default function SystemTestZeroStateBanner({ onOpenGenerator, canGenerate = true }) {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center sm:px-10">
      <FlaskConical size={26} className="mb-4 text-[var(--color-primary)]" aria-hidden="true" />
      <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">No system tests yet</h1>
      <p className="mt-2.5 max-w-sm text-xs leading-5 text-[var(--color-text-secondary)]">
        Generate Full Stack tests, review the draft, then apply it to get started.
      </p>
      <Button className="mt-5" icon={FileCode2} disabled={!canGenerate} onClick={onOpenGenerator}>Generate tests</Button>
      {!canGenerate && <p className="mt-3 text-xs text-[var(--color-text-muted)]">You need AI generation permission for this project.</p>}
    </section>
  );
}
