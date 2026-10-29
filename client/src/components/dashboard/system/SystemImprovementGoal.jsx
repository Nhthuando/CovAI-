const stopMessages = {
  TIME_LIMIT:'The time limit was reached.',
  REQUEST_LIMIT:'The AI request limit was reached.',
  NO_FURTHER_GAIN:'No further verified improvement after three rounds.',
  ROUND_LIMIT:'The candidate round limit was reached.',
  PROVIDER_LIMIT:'The AI provider could not continue.',
  CONTEXT_LIMIT:'The test context reached the supported size limit.',
  VERIFICATION_FAILED:'New tests did not pass verification.',
  SETUP_FAILED:'The test environment could not start.',
  SOURCE_CHANGED:'The source or tests changed during verification.',
  CANCELED:'The improvement was canceled.',
};

export default function SystemImprovementGoal({ goal, pending }) {
  if (!goal || !Number.isFinite(goal.lowestPct)) return null;
  return <section aria-label="Coverage target" className="space-y-2 text-xs">
    <div className="flex flex-wrap justify-between gap-2">
      <span>Target: 95%</span>
      <span className="tabular-nums text-[var(--color-text-secondary)]">Lowest metric: {goal.lowestPct.toFixed(2)}%</span>
    </div>
    {goal.reached && <p className="text-[var(--color-success)]">95% target reached</p>}
    {!goal.reached && goal.milestoneReached && <p>90% milestone reached</p>}
    {goal.unmeasured?.length > 0 && <p className="text-[var(--color-text-muted)]">Some coverage is not measured yet.</p>}
    {!pending && stopMessages[goal.stopReason] && <p className="text-[var(--color-text-muted)]">{stopMessages[goal.stopReason]}</p>}
  </section>;
}
