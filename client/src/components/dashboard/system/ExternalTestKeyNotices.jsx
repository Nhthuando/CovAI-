import { useState } from 'react';
import { PlugZap, X } from 'lucide-react';
import { Button } from '../../ui/button.jsx';

const amber = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';

function dependencyMessage(dependency) {
  const labels = dependency.services.map(service => service.label).join(', ') || 'an external service';
  const variables = dependency.variables.join(', ');
  return `This test called ${labels} and the call failed. ${variables ? `Add ${variables} to run it.` : 'Add its keys in Setup to run it.'}`;
}

export function ExternalDependencyBadge({ dependency }) {
  const label = dependency.services.map(service => service.label).join(', ') || 'test keys';
  return <span title={dependencyMessage(dependency)} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${amber}`}>
    <PlugZap size={12} /> Needs {label}
  </span>;
}

export function ExternalDependencyNotice({ dependency, onOpenSetup, children }) {
  return <div className="space-y-2 whitespace-normal py-1 text-xs font-normal">
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 ${amber}`}>
      <p className="min-w-0 break-words">{dependencyMessage(dependency)}</p>
      <Button className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40" size="sm" variant="outline" onClick={() => onOpenSetup(dependency.services[0]?.id)}>Add test key</Button>
    </div>
    {children && <details>
      <summary className="cursor-pointer text-[var(--color-text-muted)]">Technical details</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>}
  </div>;
}

export function ExternalServicesBanner({ setup, summary, snapshotId, onOpenSetup }) {
  const storageKey = `covai:external-keys-dismissed:${snapshotId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const services = setup?.externalServices?.filter(service => ['NEEDS_CONFIG', 'HARDCODED'].includes(service.status)) ?? [];
  if (dismissed || (!services.length && !(summary?.blockedByExternal > 0))) return null;

  const affected = summary?.externalServices ?? [];
  const pending = services.length ? services : affected;
  const first = pending[0];
  const variables = first?.variables?.filter(row => typeof row === 'string' || ['MISSING', 'MAY_BE_NEEDED'].includes(row.status))
    .map(row => typeof row === 'string' ? row : row.name) ?? [];
  const count = summary?.blockedByExternal || affected.reduce((sum, service) => sum + (service.scenarioCount || 0), 0)
    || services.reduce((sum, service) => sum + (service.features?.length || 0), 0);
  const title = pending.length > 1 ? <><span className="font-mono tabular-nums">{pending.length}</span> services need test keys</>
    : first ? `${first.label} needs a test key` : 'External services need test keys';
  const keys = pending.length === 1 && first?.variables?.length === 0
    ? 'its keys'
    : pending.length > 1 || !variables.length ? 'test keys' : variables.join(', ');

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(storageKey, '1');
    } catch (error) {
      console.warn('Could not persist the external service notice dismissal.', error);
    }
  }

  return <div className={`flex flex-wrap items-center gap-3 rounded-lg p-3.5 ${amber}`}>
    <PlugZap size={18} className="shrink-0" />
    <div className="min-w-0 flex-1 basis-48">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 break-words text-xs">{count ? <><span className="font-mono tabular-nums">{count}</span> {count === 1 ? 'test' : 'tests'} can't run until you add {keys}.</> : `Add ${keys} to run the affected tests.`}</p>
    </div>
    <Button className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40" size="sm" onClick={() => onOpenSetup(first?.id)}>Add test key</Button>
    <Button className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40" size="icon-sm" variant="ghost" aria-label="Dismiss external services notice" onClick={dismiss}><X /></Button>
  </div>;
}

export function DraftVerification({ draft, onOpenSetup }) {
  const dropped = draft.droppedScenarios ?? [];
  switch (draft.verificationStatus) {
    case 'VERIFIED':
      return <p className="rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Verified against your running app</p>;
    case 'PARTIAL':
      return <details className={`rounded-lg p-3 text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20`}>
        <summary className="cursor-pointer font-medium"><span className="font-mono tabular-nums">{dropped.length}</span> {dropped.length === 1 ? 'scenario' : 'scenarios'} removed after failing verification</summary>
        <ul className="mt-2 space-y-2">
          {dropped.map((scenario, index) => <li key={index}>
            <p className="font-medium">{scenario.title}</p>
            <p className="break-words">{scenario.error?.split(/\r?\n/, 1)[0]}</p>
          </li>)}
        </ul>
      </details>;
    case 'NEEDS_EXTERNAL_CONFIG':
      return <div className={`space-y-2 rounded-lg p-3 text-xs ${amber}`}>
        {draft.externalRequirements?.length ? draft.externalRequirements.map(service => (
          <div key={service.id} className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words"><span className="font-mono tabular-nums">{service.scenarios.length}</span> {service.scenarios.length === 1 ? 'scenario needs' : 'scenarios need'} {service.label}. Add {service.variables.join(', ') || 'its keys in Setup'} to run them.</p>
            <Button className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40" size="sm" variant="outline" onClick={() => onOpenSetup(service.id)}>Add test key</Button>
          </div>
        )) : <div className="flex flex-wrap items-center justify-between gap-2">
          <p>Some scenarios need external test keys.</p>
          <Button className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40" size="sm" variant="outline" onClick={() => onOpenSetup()}>Add test key</Button>
        </div>}
      </div>;
    case 'NOT_VERIFIED':
      return <p className="text-xs text-[var(--color-text-muted)]">Not verified</p>;
    default:
      return null;
  }
}
