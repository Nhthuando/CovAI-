import { FlaskConical, Sparkles } from 'lucide-react';
import Button from '../../common/Button.jsx';

export default function SystemTestZeroStateBanner({ onOpenGenerator, canGenerate = true }) {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-12 text-center sm:px-10">
      <FlaskConical size={28} className="mb-5 text-[var(--color-primary)]" aria-hidden="true" />
      <h1 className="text-xl font-semibold tracking-tight">No system tests yet</h1>
      <p className="mt-3 max-w-sm text-sm leading-6 text-[var(--color-text-secondary)]">
        Generate Full Stack tests, review the draft, then apply it to get started.
      </p>
      <Button className="mt-6" icon={Sparkles} disabled={!canGenerate} onClick={onOpenGenerator}>Generate tests</Button>
      {!canGenerate && <p className="mt-3 text-xs text-[var(--color-text-muted)]">You need AI generation permission for this project.</p>}
    </section>
  );
}
