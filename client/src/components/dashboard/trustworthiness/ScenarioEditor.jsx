import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Field, JsonEditor, SectionLabel } from './ui';
import { inputClass, interactive } from './evaluationTheme';
import { questionTypes as tasks } from './questionLabels';

const unverifiedHint = 'The generated source quote was not found in your documents. ' +
  'The judge will grade this case against the document only. Edit the quote to verify it.';

function Section({ title, children }) {
  return (
    <section className="space-y-4 border-t border-[var(--color-border)] pt-5 first:border-t-0 first:pt-0">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

export default function ScenarioEditor({ item, draft, actionEnabled, onChange }) {
  const first = item.criteria[0];
  const editableRule = first?.method === 'rule' &&
    ['containsAll', 'equals', 'orderedSteps'].includes(first.rule?.type);
  const refusal = ['OUT_OF_SCOPE', 'ADVERSARIAL'].includes(item.taskType);
  return (
    <fieldset disabled={!draft} className="min-w-0 space-y-6">
      <Section title="Question">
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label="Title">
            <input className={inputClass} value={item.title}
              onChange={event => onChange({ ...item, title: event.target.value })} />
          </Field>
          <Field label="Type">
            <select className={inputClass} value={item.taskType}
              onChange={event => onChange({ ...item, taskType: event.target.value })}>
              {Object.entries(tasks).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
        </div>
        {item.turns.map((turn, turnIndex) => (
          <Field key={turnIndex} label={item.turns.length > 1 ? `User message ${turnIndex + 1}` : 'User message'}>
            <textarea className={inputClass} rows={2} value={turn.content} onChange={event => onChange({
              ...item,
              turns: item.turns.map((value, i) => i === turnIndex ? { ...value, content: event.target.value } : value),
            })} />
          </Field>
        ))}
        {draft && item.turns.length < 10 && (
          <Button variant="ghost" size="sm"
            onClick={() => onChange({ ...item, turns: [...item.turns, { content: '' }] })}>
            <Plus aria-hidden="true" />Add follow-up message
          </Button>
        )}
      </Section>

      <Section title="Expected answer">
        <Field label={refusal ? 'What the chatbot should do' : 'What a good answer does'}>
          <textarea className={inputClass} rows={2} value={item.expectedBehavior}
            onChange={event => onChange({ ...item, expectedBehavior: event.target.value })} />
        </Field>
        {!refusal && (
          <Field label="Key facts" hint="One per line. Facts with numbers are checked by rules, not AI.">
            {/* Uncontrolled so blank lines can be typed; empty lines are dropped when the field loses focus. */}
            <textarea key={`${item.caseKey}-facts-${(item.expectedFacts || []).join('|')}`} className={inputClass} rows={3}
              defaultValue={(item.expectedFacts || []).join('\n')}
              placeholder={'Warranty is 12 months\nHotline 1900 6868'}
              onBlur={event => onChange({
                ...item,
                expectedFacts: event.target.value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 20),
              })} />
          </Field>
        )}
        {editableRule && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="Grading rule">
              <select className={inputClass} value={first.rule.type} onChange={event => onChange({
                ...item,
                criteria: [{
                  ...first,
                  rule: { type: event.target.value, expected: event.target.value === 'equals' ? '' : [] },
                }, ...item.criteria.slice(1)],
              })}>
                <option value="containsAll">Contains all points</option>
                <option value="equals">Exact match</option>
                <option value="orderedSteps">Steps in order</option>
              </select>
            </Field>
            <Field label="Expected points" hint="One per line">
              <textarea className={inputClass} rows={3}
                value={Array.isArray(first.rule.expected) ? first.rule.expected.join('\n') : first.rule.expected}
                onChange={event => onChange({
                  ...item,
                  criteria: [{
                    ...first,
                    rule: {
                      ...first.rule,
                      expected: first.rule.type === 'equals' ? event.target.value : event.target.value.split('\n'),
                    },
                  }, ...item.criteria.slice(1)],
                })} />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Source">
        <Field label="Quote from your document" hint="Copy it word for word. Leave empty if there isn't one.">
          <textarea className={inputClass} rows={3} value={item.sourceQuote || ''}
            onChange={event => onChange({ ...item, sourceQuote: event.target.value })} />
        </Field>
        {item.referenceUnverified && <Badge variant="warning" title={unverifiedHint}>Source not verified</Badge>}
      </Section>

      {item.taskType === 'ACTION_TOOL' && (
        <p className="text-sm text-[var(--color-text-muted)]">
          {actionEnabled
            ? 'Configure tools, confirmation scripts and all three safety gates in advanced configuration.'
            : 'Action tools are disabled on the server. You can prepare scenarios now and run them after the gateway is enabled.'}
        </p>
      )}
      <details className="group border-t border-[var(--color-border)] pt-5">
        <summary className={`cursor-pointer list-none rounded-md text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] ${interactive}`}>
          Advanced (JSON)
        </summary>
        <div className="mt-4">
          <JsonEditor key={`${item.caseKey}-${first?.rule?.type}`} label="Full scenario configuration"
            value={item} onChange={value => {
              if (!value.caseKey || !Array.isArray(value.turns) || !value.turns.length ||
                value.turns.some(turn => typeof turn.content !== 'string') ||
                !Array.isArray(value.criteria) || !value.criteria.length ||
                value.criteria.some(rule => !rule || typeof rule !== 'object')) {
                throw new Error('Invalid case');
              }
              onChange(value);
            }} />
        </div>
      </details>
    </fieldset>
  );
}

export function RemoveQuestionButton({ onRemove }) {
  return (
    <Button variant="destructive" size="sm" onClick={onRemove}>
      <Trash2 aria-hidden="true" />Remove
    </Button>
  );
}
