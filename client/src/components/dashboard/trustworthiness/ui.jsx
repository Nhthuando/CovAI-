import { useEffect, useId, useRef, useState } from 'react';
import { Check, Circle, Copy } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../common/Badge';
import { Card, CardHeader, CardContent } from '../../common/Card';
import { buttonClass, inputClass, tones } from './evaluationTheme';

export function StepStatusIcon({ done, current }) {
  const Icon = done ? Check : Circle;
  return <Icon role="img" aria-label={done ? 'Done' : current ? 'Current or next step' : 'Not ready'}
    fill={!done && current ? 'currentColor' : 'none'}
    className={`h-4 w-4 shrink-0 ${done ? 'text-[var(--color-success)]' : current ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`} />;
}

export function StatusBadge({ value }) {
  const status = String(value || 'NOT_EVALUATED').toUpperCase();
  let tone;
  if (['PASSED', 'COMPLETED', 'READY'].includes(status)) tone = 'emerald';
  else if (['FAILED', 'ERROR', 'CRITICAL'].includes(status)) tone = 'rose';
  else if (['INCOMPLETE', 'WARNING', 'QUEUED', 'HIGH', 'MEDIUM', 'UNVERIFIED REFERENCE'].includes(status)) {
    tone = 'amber';
  } else if (status === 'RUNNING') tone = 'sky';
  return (
    <Badge variant="default" size="sm"
      className={`rounded-md duration-150 font-mono tabular-nums ${tones[tone] || ''}`}>
      {status === 'RUNNING' && (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-ping" />
      )}
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}

export function Panel({ title, description, actions, children, className = '' }) {
  return (
    <Card className={`min-w-0 rounded-lg ${className}`}>
      {(title || actions) && (
        <CardHeader className="flex-wrap px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className="space-y-4 p-5">{children}</CardContent>
    </Card>
  );
}

export function SectionLabel({ children, className = '' }) {
  return <h3 className={`text-xs font-medium text-[var(--color-text-muted)] ${className}`}>{children}</h3>;
}

export function Field({ label, hint, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm">
      <span className="font-medium text-[var(--color-text-secondary)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--color-text-muted)]">{hint}</span>}
    </label>
  );
}

export function MetricCard({ label, value, sub, tone }) {
  return (
    <Card className={`rounded-lg p-5 ${tones[tone] || ''}`}>
      <p className="text-sm text-[var(--color-text-secondary)]">{label}</p>
      <div className="my-2 text-4xl font-semibold font-mono tabular-nums">{value}</div>
      {sub && <div className="text-sm text-[var(--color-text-muted)]">{sub}</div>}
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
      {Icon && <Icon aria-hidden="true" className="size-6 text-[var(--color-text-muted)]" />}
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="max-w-md text-sm text-[var(--color-text-muted)]">{description}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function JsonEditor({ label, value, onChange, disabled }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  return (
    <Field label={label}>
      <textarea className={`${inputClass} font-mono tabular-nums`} disabled={disabled}
        rows={8} value={text} spellCheck={false} onChange={event => {
          setText(event.target.value);
          try {
            const parsed = JSON.parse(event.target.value);
            const invalid = Array.isArray(value)
              ? !Array.isArray(parsed)
              : !parsed || typeof parsed !== 'object' || Array.isArray(parsed);
            if (invalid) throw new Error('Invalid shape');
            onChange(parsed);
            setError('');
          } catch {
            setError('Invalid JSON or configuration. These edits have not been applied.');
          }
        }} />
      {error && <span role="alert" className="text-rose-400">{error}</span>}
    </Field>
  );
}

export function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div>
      <div className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3">
        <code className="min-w-0 flex-1 break-all text-xs font-mono tabular-nums">{command}</code>
        <Button className={buttonClass} variant="ghost" size="sm" onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setError('');
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
          } catch (failure) {
            setError(failure.message || 'Could not copy the command.');
          }
        }}>
          <Copy aria-hidden="true" />{copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
    </div>
  );
}

export function SecretInput({ label, value, onChange, hint }) {
  const id = useId();
  return (
    <Field label={label}>
      <input className={inputClass} type="password" autoComplete="new-password" value={value}
        onChange={event => onChange(event.target.value)} aria-describedby={hint ? id : undefined} />
      {hint && <span id={id} className="text-xs text-[var(--color-text-muted)]">{hint}</span>}
    </Field>
  );
}
