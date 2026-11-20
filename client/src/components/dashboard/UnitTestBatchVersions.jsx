import { useMemo } from 'react';

export default function UnitTestBatchVersions({ unitTestVersions, onSwitchVersion, isSwitchingVersion, onReviewDiff, isLight, compact = false }) {
  const batches = useMemo(() => {
    const groups = new Map();
    const activeId = Object.values(unitTestVersions).find(file => file.activeBatchId)?.activeBatchId;
    for (const file of Object.values(unitTestVersions)) for (const version of file.versions || []) {
      if (!version.batchId) continue;
      if (!groups.has(version.batchId)) groups.set(version.batchId,{...version,files:[],active:version.batchId === activeId});
      groups.get(version.batchId).files.push({...file,version});
    }
    return [...groups.values()].sort((a,b) => b.version - a.version);
  }, [unitTestVersions]);
  const active = batches.find(batch => batch.active);
  const legacy = Object.values(unitTestVersions).flatMap(file => (file.versions || []).filter(version => !version.batchId).map(version => ({...version,testFile:file.testFile})));
  const isV1Active = !active || active.version === 1;
  const content = <div style={{padding:14,background:isLight?'white':'#111827',color:isLight?'#0f172a':'#e2e8f0',border:'1px solid #64748b50',borderRadius:8,minWidth:300}}>
    <p style={{fontSize:12,marginTop:0}}>Versions are created only after the entire batch passes verification. Switching versions verifies the complete batch before changing the active version.</p>
    {/* Baseline Version 1 Section */}
    <section style={{padding:'12px 0',borderTop:'1px solid #64748b40'}}>
      <div style={{display:'flex',gap:12,justifyContent:'space-between',alignItems:'center'}}>
        <strong>Version 1 (Baseline) {isV1Active ? '· Active' : ''}</strong>
        <button type="button" disabled={isV1Active || isSwitchingVersion} onClick={() => onSwitchVersion?.({targetVersion:1,allFiles:true})}>
          {isV1Active ? '✓ Active' : isSwitchingVersion ? 'Verifying…' : 'Revert all files to Version 1 (Baseline)'}
        </button>
      </div>
      <div style={{fontSize:11,marginTop:5}}>Baseline / original unit test suite captured before AI suggestions</div>
    </section>
    {batches.map(batch => {
      const isHistorical = active && batch.version < active.version;
      const buttonLabel = batch.active ? '✓ Active' : isSwitchingVersion ? 'Verifying…' : isHistorical ? 'Revert all files to this version' : 'Verify & Switch to This Version';
      return (
        <section key={batch.batchId} style={{padding:'12px 0',borderTop:'1px solid #64748b40'}}>
          <div style={{display:'flex',gap:12,justifyContent:'space-between',alignItems:'center'}}>
            <strong>Version {batch.version} {batch.active ? '· Active' : ''}</strong>
            <button type="button" disabled={batch.active || isSwitchingVersion} onClick={() => onSwitchVersion?.({targetVersion:batch.version,allFiles:true})}>
              {buttonLabel}
            </button>
          </div>
          <div style={{fontSize:11,marginTop:5}}>{batch.createdAt ? new Date(batch.createdAt).toLocaleString('en-US') : ''} · {batch.files.length} changed files · {batch.verified ? 'Verified' : 'Unverified'}</div>
          <details style={{marginTop:7,fontSize:12}}><summary>View files and diffs</summary>{batch.files.map(file => <div key={file.testFile} style={{padding:'5px 0'}}>{file.testFile} {onReviewDiff && <button type="button" onClick={() => onReviewDiff(file.sourceFile || file.testFile)}>View diff</button>}</div>)}</details>
        </section>
      );
    })}
    {legacy.length > 0 && <details style={{marginTop:12,fontSize:12}}><summary>Legacy history · not verified as a batch ({legacy.length} records)</summary>{legacy.map(version => <details key={`${version.testFile}:${version.versionId}`} style={{padding:'6px 0'}}><summary>{version.testFile} · Version {version.version}</summary><p>{version.summary}</p><pre style={{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}}>{version.content}</pre></details>)}</details>}
  </div>;
  return compact ? <details style={{position:'relative'}}><summary style={{cursor:'pointer',fontSize:12}}>Active: Version {active?.version || 1}</summary><div style={{position:'absolute',right:0,top:'100%',zIndex:60,width:440,maxWidth:'90vw',maxHeight:500,overflow:'auto'}}>{content}</div></details> : content;
}
