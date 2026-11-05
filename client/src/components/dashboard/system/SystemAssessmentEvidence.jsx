import { useEffect, useState } from 'react';
import { getSystemRunArtifact } from '../../../services/systemTest.service.js';
export default function SystemAssessmentEvidence({ snapshotId, scenario }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState('');
  const image = scenario.artifacts?.find(row => row.kind === 'SCREENSHOT' && !row.expiredAt);
  useEffect(() => {
    if (!image?.id || !snapshotId) return;
    const controller = new AbortController();
    let url;
    getSystemRunArtifact(snapshotId, image.id, { signal: controller.signal }).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setPreview({ id: image.id, url });
    }).catch(err => { if (!controller.signal.aborted) setError(err.response?.status === 410 ? 'This screenshot has expired.' : 'Could not load the captured screenshot.'); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [snapshotId, image?.id]);
  const downloadTrace = async artifact => {
    try {
      const blob = await getSystemRunArtifact(snapshotId, artifact.id);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `trace-${artifact.id}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Could not download this trace. It may have expired.'); }
  };
  return <section className="space-y-2"><h5 className="text-xs font-semibold text-[var(--color-text-secondary)]">Captured evidence</h5>{error && <p role="alert" className="text-xs text-rose-600">{error}</p>}{preview?.id === image?.id && preview ? <a href={preview.url} target="_blank" rel="noreferrer"><img src={preview.url} alt={`Captured outcome: ${scenario.title}`} className="max-h-80 max-w-full rounded-lg border border-[var(--color-border)] object-contain" /></a> : <p className="text-xs text-[var(--color-text-muted)]">{image ? 'Loading screenshot…' : scenario.artifacts?.some(row => row.expiredAt) ? 'Evidence has expired under the retention policy.' : 'No screenshot captured.'}</p>}{scenario.artifacts?.filter(row => row.kind === 'TRACE' && !row.expiredAt).map(row => <button type="button" key={row.id} onClick={() => downloadTrace(row)} className="mr-3 text-xs underline">Download trace · run {row.runIndex || 'unknown'}</button>)}</section>;
}
