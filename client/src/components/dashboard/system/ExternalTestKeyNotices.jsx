import { KeyRound, PlugZap } from 'lucide-react';
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

export function ExternalCallNote({ failure }) {
  const call = failure.calls[0];
  const label = failure.services[0]?.label || call?.host || failure.hosts[0];
  const status = call?.status ?? call?.code;
  return <p className="flex items-start gap-1 whitespace-normal text-xs text-[var(--color-text-secondary)]">
    <PlugZap size={12} className="shrink-0" aria-hidden="true" />
    <span>{label} {status == null ? 'gave no response' : `returned ${status}`} during this test. {failure.category === 'REQUEST_REJECTED' && 'The request was rejected. '}Check the test data or how the app handles this response.</span>
  </p>;
}

const sky = 'bg-sky-500/10 text-sky-400 border border-sky-500/20';
const bannerButton = 'shrink-0 transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40';

export function ExternalServicesBanner({ setup, summary, onOpenSetup, onRunTests, running = false }) {
  const services = setup?.externalServices?.filter(service => ['NEEDS_CONFIG', 'HARDCODED'].includes(service.status)) ?? [];
  const blocked = summary?.blockedByExternal ?? 0;
  if (!services.length && blocked <= 0) return null;

  // Every key is present now, yet the last run was blocked: either the key arrived after that run
  // (re-run to retry) or the provider rejected the key that was used (replace it).
  if (!services.length && blocked > 0) {
    const blockedService = summary?.externalServices?.[0];
    const label = summary?.externalServices?.length > 1 ? 'External services' : blockedService?.label || 'An external service';
    const keySavedAt = Date.parse(setup?.secrets?.updatedAt || '');
    const runStartedAt = Date.parse(summary?.runStartedAt || '');
    const addedAfterRun = Number.isFinite(keySavedAt) && (!Number.isFinite(runStartedAt) || keySavedAt > runStartedAt);
    const tests = blocked === 1 ? '1 blocked test' : `${blocked} blocked tests`;
    if (addedAfterRun) {
      return <div className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 ${sky}`}>
        <KeyRound size={16} className="shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words text-sm"><strong>{label}</strong> key added. Run tests again to retry the {tests}.</p>
        {onRunTests && <Button className={bannerButton} size="sm" disabled={running} onClick={() => onRunTests()}>Run tests</Button>}
      </div>;
    }
    return <div className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 ${amber}`}>
      <KeyRound size={16} className="shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words text-sm"><strong>{label}</strong> rejected the test key — {blocked === 1 ? '1 test was' : `${blocked} tests were`} blocked in the last run. Use a valid test-mode key.</p>
      <Button className={bannerButton} size="sm" onClick={() => onOpenSetup(blockedService?.id)}>Replace key</Button>
    </div>;
  }

  const pending = services.length ? services : (summary?.externalServices ?? []);
  const first = pending[0];
  const features = first?.features ?? [];
  const blocksStartup = services.some(service => service.variables?.some(variable => variable.required && variable.status === 'MISSING'));
  let detail = '.';
  if (blocksStartup) {
    detail = ' — your backend can\'t start without it, so no tests can run yet.';
  } else if (blocked > 0) {
    detail = blocked === 1 ? ' — 1 test was blocked in the last run.' : ` — ${blocked} tests were blocked in the last run.`;
  } else if (features.length === 1) {
    const { method, path } = features[0];
    detail = <> for {method?.toUpperCase()} <span className="font-mono">{path}</span>.</>;
  } else if (features.length > 1) {
    detail = ` for ${features.length} features.`;
  }

  return <div className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 ${amber}`}>
    <KeyRound size={16} className="shrink-0" aria-hidden="true" />
    <p className="min-w-0 flex-1 break-words text-sm">
      {pending.length > 1
        ? <><strong><span className="font-mono tabular-nums">{pending.length}</span> services</strong> need test keys.</>
        : <><strong>{first?.label || 'An external service'}</strong> needs a test key{detail}</>}
    </p>
    <Button className="shrink-0 transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40" size="sm" onClick={() => onOpenSetup(first?.id)}>Add key</Button>
  </div>;
}

function droppedScenarioReason(error = '') {
  const timeout = error?.match(/Test timeout of (\d+)ms exceeded/);
  if (timeout) return `Timed out after ${Number(timeout[1]) / 1000}s`;
  if (/Timeout \d+ms exceeded/.test(error)) return "An element didn't appear in time";
  return error?.split(/\r?\n/, 1)[0].slice(0, 160);
}

export function DraftVerification({ draft, onOpenSetup }) {
  const dropped = draft.droppedScenarios ?? [];
  switch (draft.verificationStatus) {
    case 'VERIFIED':
      return <p className="rounded-md px-3 py-2 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">All scenarios passed on your app</p>;
    case 'PARTIAL':
      return <details className={`rounded-lg p-3 text-xs ${amber}`}>
        <summary className="cursor-pointer font-medium">
          <span className="font-mono tabular-nums">{dropped.length}</span> {dropped.length === 1 ? 'scenario' : 'scenarios'} left out — couldn't pass on your app
          <span className="mt-1 block text-xs font-normal text-[var(--color-text-secondary)]">The other scenarios passed and are safe to apply.</span>
        </summary>
        <ul className="mt-2 space-y-2">
          {dropped.map((scenario, index) => <li key={index}>
            <p className="font-medium">{scenario.title}</p>
            <p className="break-words">{droppedScenarioReason(scenario.error)}</p>
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
    case 'NOT_VERIFIED': {
      const missingKeys = draft.verificationError?.match(/requires test environment configuration: ([^.]+)\./)?.[1];
      if (missingKeys) {
        return <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${amber}`}>
          <p className="min-w-0 flex-1">Couldn't run these on your app: the backend needs <span className="font-mono">{missingKeys}</span> to start. Add the key, then regenerate to verify.</p>
          <Button className="transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40" size="sm" variant="outline" onClick={() => onOpenSetup()}>Add key</Button>
        </div>;
      }
      return draft.verificationError
        ? <p className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">Couldn't run these on your app: {draft.verificationError.split(/\r?\n/, 1)[0].slice(0, 200)}</p>
        : null;
    }
    default:
      return null;
  }
}
