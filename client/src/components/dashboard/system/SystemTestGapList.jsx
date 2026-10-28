export default function SystemTestGapList({ gaps, selected, onChange }) {
  return <fieldset className="space-y-2 max-h-64 overflow-auto">
    <legend className="font-semibold mb-2">Evidence-backed gaps</legend>
    {!gaps.length && <p>No gaps established within the measured scope. This does not establish complete correctness.</p>}
    {gaps.map(gap => <label key={gap.id} className="flex items-start gap-2 p-2 border-b border-[var(--color-border)]">
      <input type="checkbox" checked={selected.includes(gap.id)} onChange={event => onChange(event.target.checked ? [...selected, gap.id] : selected.filter(id => id !== gap.id))} />
      <span><span className="block text-[var(--color-text-muted)]">{gap.kind} {gap.filePath && `${gap.filePath}:${gap.line}`}</span>{gap.description}</span>
    </label>)}
  </fieldset>;
}
