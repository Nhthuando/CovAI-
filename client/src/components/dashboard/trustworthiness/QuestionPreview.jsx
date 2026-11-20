import { Bot, FileText, Ruler, Sparkles, TriangleAlert, User } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Hint } from '../../ui/tooltip';
import { isExactFact } from './questionIcons';

const refusalTypes = ['OUT_OF_SCOPE', 'ADVERSARIAL'];

// Marks the parts of the document quote that a key fact relies on (whole fact, or its numbers).
function highlightQuote(quote, facts) {
  const needles = new Set();
  for (const fact of facts) {
    const text = String(fact || '').trim();
    if (text.length >= 3 && quote.toLowerCase().includes(text.toLowerCase())) needles.add(text);
    for (const match of text.matchAll(/\d[\d.,]*\s*[\p{L}%]*/gu)) {
      const token = match[0].trim();
      if (token && quote.toLowerCase().includes(token.toLowerCase())) needles.add(token);
    }
  }
  if (!needles.size) return quote;
  const escaped = [...needles].sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'giu');
  return quote.split(pattern).map((part, index) => (index % 2 === 1
    ? <mark key={index} className="rounded-[3px] bg-amber-400/20 px-0.5 text-[var(--color-text)]">{part}</mark>
    : part));
}

function Bubble({ who, children }) {
  const isUser = who === 'user';
  const Icon = isUser ? User : Bot;
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border ${isUser
        ? 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'
        : 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]'}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function QuestionPreview({ item }) {
  const userTurns = (item.turns || []).filter(turn => !turn.role || turn.role === 'user');
  const facts = (item.expectedFacts || []).filter(Boolean);
  const refusal = refusalTypes.includes(item.taskType);
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {userTurns.map((turn, index) => (
          <Bubble key={index} who="user">
            {userTurns.length > 1 && <p className="mb-1 text-xs text-[var(--color-text-muted)]">Message <span className="font-mono tabular-nums">{index + 1}</span></p>}
            <p className="w-fit max-w-full whitespace-pre-wrap break-words rounded-lg rounded-tl-sm bg-[var(--color-surface-secondary)] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--color-text)]">
              {turn.content || <span className="text-[var(--color-text-muted)]">Empty message</span>}
            </p>
          </Bubble>
        ))}
      </div>

      <Bubble who="bot">
        <div className="space-y-3 rounded-lg border border-dashed border-[var(--color-border-strong)] p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            {refusal ? 'The chatbot should' : 'A good answer'}
          </p>
          {item.expectedBehavior && <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{item.expectedBehavior}</p>}
          {facts.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Key facts">
              {facts.map(fact => {
                const exact = isExactFact(fact);
                const Icon = exact ? Ruler : Sparkles;
                return (
                  <li key={fact}>
                    <Hint text={exact ? 'Checked by rules: the number must match exactly' : 'Checked by the grading AI'}>
                      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${exact
                        ? 'border-sky-500/20 bg-sky-500/10 text-sky-300'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'}`}>
                        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                        {fact}
                      </span>
                    </Hint>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Bubble>

      {item.sourceQuote ? (
        <figure className="space-y-2">
          <figcaption className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <FileText className="size-3.5" aria-hidden="true" />
            From your documents
            {item.referenceUnverified
              ? <Badge variant="warning"><TriangleAlert aria-hidden="true" />Not found word for word</Badge>
              : <Badge variant="success">Verified</Badge>}
          </figcaption>
          <blockquote className="border-l-2 border-[var(--color-border-strong)] pl-4 text-sm italic leading-relaxed text-[var(--color-text-secondary)]">
            {highlightQuote(item.sourceQuote, facts)}
          </blockquote>
        </figure>
      ) : !refusal && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <FileText className="size-3.5" aria-hidden="true" />No document quote
        </p>
      )}
    </div>
  );
}
