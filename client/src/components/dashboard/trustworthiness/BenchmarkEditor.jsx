import { useState } from 'react';
import { CopyPlus, FolderPlus, Gauge, ListChecks } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Hint } from '../../ui/tooltip';
import { Skeleton } from '../../common/Skeleton';
import { useTrustworthinessQuery } from '../../../hooks/useTrustworthinessQuery';
import { Field, EmptyState } from './ui';
import { inputClass } from './evaluationTheme';
import ProfileEditor from './ProfileEditor';

function QuotaMeter({ quota, estimate }) {
  const { remaining, limit } = quota;
  if (remaining == null || !limit) return null;
  const worst = estimate.worstCase ?? estimate.max;
  const tight = worst != null && remaining < worst;
  const low = estimate.max != null && remaining < estimate.max;
  const tone = low ? 'bg-rose-400' : tight ? 'bg-amber-400' : 'bg-emerald-400';
  const text = `${remaining} of ${limit} AI requests left today. One run uses about ${estimate.min ?? '—'}–${estimate.max ?? '—'}` +
    `${estimate.worstCase != null ? `, up to ${estimate.worstCase} if grading is retried` : ''}.` +
    `${tight ? ' Some checks may end up not graded.' : ''}`;
  return (
    <Hint text={text}>
      <div tabIndex={0} className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50">
        <Gauge className="size-4" aria-hidden="true" />
        <span className="h-1.5 w-20 overflow-hidden rounded-md bg-[var(--color-surface-muted)]" aria-hidden="true">
          <span className={`block h-full ${tone}`} style={{ width: `${Math.min(100, (remaining / limit) * 100)}%` }} />
        </span>
        <span><span className="font-mono tabular-nums text-[var(--color-text-secondary)]">{remaining}/{limit}</span> AI requests</span>
      </div>
    </Hint>
  );
}

export default function BenchmarkEditor({
  projectId, data, capabilities, api, act, busy, selectedVersion, navigateView, prepareByVersion, actionEnabled,
}) {
  const [name, setName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [preparation, setPreparation] = useState({ versionId: '', id: '' });
  const versionId = selectedVersion || data.profiles.find(profile => !profile.archivedAt)?.versions[0]?.id;
  const version = useTrustworthinessQuery(projectId, `/profile-versions/${versionId}`, { enabled: !!versionId });
  const preparationId = preparation.versionId === versionId ? preparation.id : (version.data?.latestPreparation?.id || '');
  const proposal = useTrustworthinessQuery(projectId, `/preparations/${preparationId}`, {
    enabled: !!preparationId,
    poll: true,
    stopWhenDone: true,
  });
  const quota = capabilities.quota || {};
  const estimate = quota.bestCaseRunEstimate || {};
  const profiles = data.profiles.filter(profile => !profile.archivedAt);
  const selectedProfile = profiles.find(profile => profile.versions.some(item => item.id === versionId));
  const versions = profiles.flatMap(profile => profile.versions.map(item => ({ profile, item })));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {versions.length > 1 ? (
            <select aria-label="Test set version" className={`${inputClass} w-auto font-medium`} value={versionId || ''}
              onChange={event => navigateView('questions', { profileVersionId: event.target.value })}>
              {versions.map(({ profile, item }) => (
                <option key={item.id} value={item.id}>{profile.name} · v{item.version}</option>
              ))}
            </select>
          ) : (
            <span className="font-semibold tracking-tight">{selectedProfile?.name || profiles[0]?.name || 'Test set'}</span>
          )}
          {version.data && <>
            {versions.length <= 1 && <Badge variant="outline" className="font-mono tabular-nums">v{version.data.version}</Badge>}
            <Badge variant={version.data.status === 'APPROVED' ? 'success' : 'warning'}>
              {version.data.status === 'APPROVED' ? 'Approved' : 'Draft'}
            </Badge>
          </>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuotaMeter quota={quota} estimate={estimate} />
          {version.data?.status === 'APPROVED' && <Button variant="secondary" size="sm" disabled={busy}
            onClick={() => act(async () => {
              const next = await api(`/profiles/${version.data.profileId}/versions`, 'POST', {});
              navigateView('questions', { profileVersionId: next.id });
            })}><CopyPlus aria-hidden="true" />New draft</Button>}
          <Button variant="ghost" size="sm" aria-expanded={showCreate}
            onClick={() => setShowCreate(!showCreate)}><FolderPlus aria-hidden="true" />New test set</Button>
        </div>
      </div>
      {showCreate && (
        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4" onSubmit={event => {
          event.preventDefault();
          act(async () => {
            const profile = await api('/profiles', 'POST', { name });
            setName('');
            setShowCreate(false);
            navigateView('questions', { profileVersionId: profile.versions[0].id });
          });
        }}>
          <div className="min-w-[240px] flex-1">
            <Field label="Name">
              <input className={inputClass} required autoFocus value={name} placeholder="Shop policy questions"
                onChange={event => setName(event.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>Create</Button>
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
        </form>
      )}
      {version.error && <p role="alert" className="text-sm text-rose-400">{version.error.message}</p>}
      {version.isFetching && !version.data && versionId && (
        <div role="status" aria-label="Loading test set" className="space-y-4">
          <Skeleton rounded="rounded-lg" className="h-16 w-full" />
          <Skeleton rounded="rounded-lg" className="h-96 w-full" />
        </div>
      )}
      {!versionId && <EmptyState icon={ListChecks} title="Create your first test set"
        description="A test set holds the questions CovAI asks your chatbot."
        action={<Button onClick={() => setShowCreate(true)}><FolderPlus aria-hidden="true" />New test set</Button>} />}
      {version.data && (
        <ProfileEditor key={version.data.id} version={version.data} refetchVersion={version.refetch}
          data={data} capabilities={capabilities} api={api} act={act} busy={busy}
          actionEnabled={actionEnabled} proposal={proposal} progress={prepareByVersion[versionId]}
          preparationId={preparationId} setPreparationId={id => setPreparation({ versionId, id })} />
      )}
    </div>
  );
}
