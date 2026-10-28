import { useEffect, useState } from 'react';

const duration = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export function SystemImprovementUsage({ usage }) {
  if (!usage?.requests) return <p className="text-xs text-[var(--color-text-muted)]">No AI requests were made.</p>;
  return <dl className="grid grid-cols-2 gap-4 text-xs">
    <div><dt className="text-[var(--color-text-muted)]">AI requests</dt><dd className="mt-1 tabular-nums">{usage.requests} / {usage.maxRequests}</dd></div>
    <div><dt className="text-[var(--color-text-muted)]">Reported tokens</dt><dd className="mt-1 tabular-nums">{usage.reportedRequests ? usage.totalTokens.toLocaleString('en-US') : 'Unavailable'}{usage.incomplete ? ' (partial)' : ''}</dd></div>
  </dl>;
}

export default function SystemImprovementProgress({ proposal, pending }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const timing = proposal.timing;
  const elapsed = timing?.startedAt ? (timing.finishedAt ? Date.parse(timing.finishedAt) : now) - Date.parse(timing.startedAt) : timing?.elapsedMs || 0;
  const age = timing?.sampledAt ? Math.max(0, now - Date.parse(timing.sampledAt)) : 0;
  const remaining = timing?.remaining && timing.remaining.maxMs > age ? {minMs:Math.max(0,timing.remaining.minMs-age),maxMs:timing.remaining.maxMs-age} : null;
  const minMinutes = remaining ? Math.max(1, Math.ceil(remaining.minMs / 60000)) : 0;
  const maxMinutes = remaining ? Math.max(1, Math.ceil(remaining.maxMs / 60000)) : 0;
  const estimate = proposal.jobStatus === 'QUEUED' || proposal.state === 'QUEUED' ? 'Waiting to start' : remaining
    ? `About ${minMinutes === maxMinutes ? minMinutes : `${minMinutes}–${maxMinutes}`} min left`
    : (timing?.estimateStatus === 'OVERRUN' || timing?.remaining && !remaining) ? 'Taking longer than usual' : 'Estimating time remaining';
  return <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs text-[var(--color-text-muted)]">
    {pending && <span aria-label="Estimated time remaining" className="font-medium text-[var(--color-text-secondary)]">{estimate}</span>}
    {timing?.startedAt && <span className="tabular-nums">Elapsed: {duration(elapsed)}</span>}
  </div>;
}
