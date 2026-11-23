const latest = items => [...items].sort((a, b) =>
  (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
  || (b.version || 0) - (a.version || 0))[0];

export function getStepStatus(workspaceData = {}) {
  const targets = (workspaceData.targets || []).filter(target => !target.archivedAt);
  const saved = targets.flatMap(target => (target.versions || []).map(version => ({ target, version })));
  const connected = saved[0];
  let connection = 'Not connected yet';
  if (connected) {
    const { target, version } = connected;
    connection = target.name || 'Chatbot';
    if (version.config?.executionMode === 'MANAGED_PROJECT') {
      connection += ' · started from your project';
    } else if (version.config?.endpoint) {
      try {
        connection += ` · ${new URL(version.config.endpoint).host}`;
      } catch {
        connection = target.name || 'Chatbot';
      }
    }
  }
  const sources = workspaceData.sources || [];
  const ready = sources.filter(source => source.status === 'READY').length;
  const processing = sources.filter(source => ['QUEUED', 'PROCESSING'].includes(source.status)).length;
  const versions = (workspaceData.profiles || []).filter(profile => !profile.archivedAt)
    .flatMap(profile => profile.versions || []);
  const approved = latest(versions.filter(version => version.status === 'APPROVED'));
  const cases = approved?.cases;
  const unverified = cases?.filter(item => item.referenceUnverified || item.definition?.referenceUnverified).length || 0;
  const run = latest(workspaceData.runs || []);
  const runLabels = {
    QUEUED: 'Waiting to start', RUNNING: 'Evaluation in progress', PROCESSING: 'Preparing results',
    COMPLETED: 'Evaluation complete', ERROR: 'Run failed', FAILED: 'Run failed',
    CANCELLED: 'Run cancelled', CANCELED: 'Run cancelled',
  };
  return {
    connect: { done: !!connected, summary: connection },
    documents: {
      done: ready > 0,
      summary: `${ready ? `${ready} document${ready === 1 ? '' : 's'} ready` : 'No documents yet'}${processing ? `, ${processing} processing` : ''}`,
    },
    questions: {
      done: !!approved,
      summary: approved
        ? `${Array.isArray(cases) ? `${cases.length} questions approved` : 'Questions approved'}${unverified ? ` · ${unverified} need a source check` : ''}`
        : versions.some(version => version.status === 'DRAFT') ? 'Draft waiting for review' : 'No approved questions yet',
    },
    run: { done: run?.executionStatus === 'COMPLETED', summary: run ? runLabels[run.executionStatus] || 'Run status unavailable' : 'No runs yet' },
  };
}

export function nextStep(status) {
  return ['connect', 'documents', 'questions'].find(key => !status[key].done) || 'run';
}
