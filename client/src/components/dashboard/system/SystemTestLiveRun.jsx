import { attachSocketAuthRecovery, socketAuth } from "../../../lib/authSession.js";
import { deriveLiveRunState, contiguousCursor } from './systemLiveRunModel.js';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Monitor,
  Square,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Play,
  ChevronDown,
} from 'lucide-react';
import { systemEvidenceRequest, getSystemRunArtifact } from '../../../services/systemTest.service.js';
import { cancelJobApi, getJobDetailApi } from '../../../services/job.service.js';
import { useProjectAccess } from '../../../hooks/useProjectAccess';
import { useAuth } from '../../../hooks/useAuth';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Hint } from '../../ui/tooltip';
import LiveFrameCanvas from './LiveFrameCanvas.jsx';

const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
const getToken = () => {
  try {
    return localStorage.getItem('token') || JSON.parse(localStorage.getItem('user') || 'null')?.token;
  } catch {
    return localStorage.getItem('token');
  }
};

const scenarioEvent = /^SCENARIO_(?:QUEUED|PENDING|STARTED|ENDED|PASSED|FAILED)$/;
const runEvent = /^(?:ASSESSMENT|RUN)_(?:STARTED|ENDED)$/;
const internalStep = /^(?:(?:create|close) (?:context|page)\b|launch browser\b|fixture:|_covai)/i;
const liveRunSpeedKey = 'covai.liveRun.speed';
const terminalJobStatuses = ['SUCCESS', 'COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED'];

function assessmentState(record) {
  return {
    id: record.id,
    jobId: record.jobId,
    snapshotId: record.snapshotId,
    status: record.status,
    failed: record.reportJson?.runs?.some(run => run.testRun?.status === 'FAILED' || run.testRun?.failedTests > 0),
  };
}

function summarizeScenarios(events, runIndex) {
  const runEvents = events.filter(event => Number(event.runIndex || 1) === Number(runIndex));
  const start = runEvents.find(event => event.type === 'RUN_STARTED')?.payloadJson;
  const end = runEvents.findLast(event => event.type === 'RUN_ENDED');
  const summary = { ...start, ...end?.payloadJson };
  const planned = start?.scenarios;
  const scenarios = new Map();
  const keysByTitle = new Map();

  function update(title, file, event) {
    if (!title) return;
    const key = file ? `${file} › ${title}` : keysByTitle.get(title) || title;
    const previous = scenarios.get(key) || scenarios.get(title);
    if (file && previous?.key === title) scenarios.delete(title);
    const row = { status: 'pending', ...previous, key, title };
    if (event?.type === 'SCENARIO_STARTED') {
      row.status = 'running';
      row.startedAt = event.createdAt;
      row.endedAt = undefined;
      row.duration = undefined;
    } else if (event && /^SCENARIO_(?:ENDED|PASSED|FAILED)$/.test(event.type)) {
      const payload = event.payloadJson;
      const outcome = event.type === 'SCENARIO_ENDED' ? payload.status?.toUpperCase() : event.type.slice(9);
      if (['PASSED', 'FAILED'].includes(outcome)) row.status = outcome.toLowerCase();
      else if (row.status === 'running') row.status = 'pending';
      row.duration = payload.durationMs ?? payload.duration ?? row.duration;
      row.endedAt = event.createdAt || row.endedAt;
    }
    scenarios.set(key, row);
    keysByTitle.set(title, key);
  }

  if (Array.isArray(planned)) {
    for (const scenario of planned) {
      if (typeof scenario === 'string') update(scenario);
      else update(scenario?.title, scenario?.testFile);
    }
  }

  for (const event of runEvents) {
    if (!scenarioEvent.test(event.type) || !event.payloadJson?.title) continue;
    update(event.payloadJson.title, event.payloadJson.testFile || event.testFile, event);
  }

  const rows = [...scenarios.values()];
  const passed = rows.filter(scenario => scenario.status === 'passed').length;
  const failed = rows.filter(scenario => scenario.status === 'failed').length;
  const total = Number(summary?.totalScenarios ?? summary?.totalTests ?? summary?.scenarioCount ?? summary?.total)
    || (Array.isArray(planned) ? planned.length : 0)
    || (end ? rows.length : 0);
  return { rows, passed, failed, total: total ? Math.max(total, rows.length) : 0 };
}

function BrowserViewer({ canvasRef, checkpoint, live, ended }) {
  const [stats, setStats] = useState({ url: 'about:blank', fps: 0, hasFrame: false });

  return (
    <div className="min-w-0 lg:col-span-8">
      <div className="flex h-10 min-w-0 items-center gap-2 rounded-t-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2.5 sm:gap-3 sm:px-3">
        <span aria-hidden="true" className="flex shrink-0 gap-1">
          <span className="size-2 rounded-full bg-[var(--color-text-muted)]/50" />
          <span className="size-2 rounded-full bg-[var(--color-text-muted)]/50" />
          <span className="size-2 rounded-full bg-[var(--color-text-muted)]/50" />
        </span>
        <input
          aria-label="Current browser URL"
          readOnly
          value={stats.url}
          title={stats.url}
          className="h-6 min-w-0 flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-xs text-[var(--color-text-secondary)]"
        />
        {(live || ended) && (
          <Badge variant={live ? 'danger' : 'secondary'} className={live ? 'text-[var(--color-danger)]' : ''}>
            {live && <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />}
            {live ? 'LIVE' : 'Ended'}
          </Badge>
        )}
        {live && stats.fps > 0 && <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">{stats.fps} fps</span>}
      </div>
              <div className="relative aspect-video w-full overflow-hidden rounded-b-lg border-x border-b border-[var(--color-border)] bg-neutral-950">
        {!stats.hasFrame && (checkpoint?.url ? (
          <div className="absolute inset-0 grid place-items-center">
            <img
              src={checkpoint.url}
              alt={`Browser checkpoint: ${checkpoint.title || 'Scenario execution'}`}
              className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
            />
            <div className="absolute inset-x-2 bottom-2 flex justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]">
              <span className="truncate">Captured: {checkpoint.title || 'Current Step'}</span>
              <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">{checkpoint.time}</span>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-neutral-300">
            <Monitor size={22} aria-hidden="true" />
            <span>{live ? 'Waiting for the browser…' : 'Pick a test case and press Run to watch it here'}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <LiveFrameCanvas ref={canvasRef} onFrameStats={setStats} />
        </div>
      </div>
    </div>
  );
}

function RunScenarios({ scenarios, events, preparationLogs, finished }) {
  const panel = useRef(null);
  const runningRow = useRef(null);
  const log = useRef(null);
  const followsLatest = useRef(true);
  const [logOpen, setLogOpen] = useState(false);
  const [showInternalSteps, setShowInternalSteps] = useState(false);
  const activeKey = finished ? undefined : scenarios.findLast(row => row.status === 'running')?.key;
  const recentEvents = logOpen ? events.slice(-300) : [];
  const visibleEvents = showInternalSteps ? recentEvents : recentEvents.filter(event => (
    runEvent.test(event.type) || scenarioEvent.test(event.type) || !internalStep.test(event.payloadJson?.stepTitle || event.payloadJson?.title)
  ));

  useEffect(() => {
    if (!runningRow.current || !panel.current) return;
    const row = runningRow.current.getBoundingClientRect();
    const viewport = panel.current.getBoundingClientRect();
    if (row.top < viewport.top) panel.current.scrollBy(0, row.top - viewport.top);
    else if (row.bottom > viewport.bottom) panel.current.scrollBy(0, row.bottom - viewport.bottom);
  }, [activeKey]);

  useEffect(() => {
    if (logOpen && log.current && followsLatest.current) log.current.scrollTop = log.current.scrollHeight;
  }, [logOpen, recentEvents.at(-1)?.sequence, preparationLogs.length, showInternalSteps]);

  return (
    <div className="relative min-w-0 lg:col-span-4">
      <aside ref={panel} className="max-h-[70vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] lg:absolute lg:inset-0 lg:max-h-none">
        <h2 className="px-3 py-2.5 text-sm font-semibold">Scenarios</h2>
        {scenarios.length > 0 ? (
          <ul className="space-y-0.5 px-2 pb-2">
            {scenarios.map(row => {
              const status = finished && row.status === 'running' ? 'pending' : row.status;
              const duration = row.duration ?? (row.endedAt && row.startedAt ? new Date(row.endedAt) - new Date(row.startedAt) : undefined);
              const active = row.key === activeKey;
              return (
                <li key={row.key} ref={active ? runningRow : null} className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs ${active ? 'bg-[var(--color-primary)]/10' : ''}`}>
                  <span className="grid size-4 shrink-0 place-items-center" role="img" aria-label={status}>
                    {status === 'running' && <Loader2 size={14} className="animate-spin text-[var(--color-primary)]" />}
                    {status === 'passed' && <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />}
                    {status === 'failed' && <XCircle size={14} className="text-[var(--color-danger)]" />}
                    {status === 'pending' && <span className="size-1.5 rounded-full bg-[var(--color-text-muted)]" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={row.title}>{row.title}</span>
                  {Number.isFinite(duration) && duration >= 0 && (
                    <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">{duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <p className="px-3 pb-3 text-xs text-[var(--color-text-muted)]">No scenarios recorded yet.</p>}
        <details className="group border-t border-[var(--color-border)]" onToggle={event => setLogOpen(event.currentTarget.open)}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} className="-rotate-90 text-[var(--color-text-muted)] group-open:rotate-0" aria-hidden="true" />
            Step log
          </summary>
          <label className="flex items-center gap-2 px-3 pb-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={showInternalSteps} onChange={event => setShowInternalSteps(event.target.checked)} className="accent-[var(--color-primary)]" />
            Show internal steps
          </label>
          <div
            ref={log}
            className="max-h-56 overflow-y-auto px-3 pb-2"
            onScroll={event => {
              const node = event.currentTarget;
              followsLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
            }}
          >
            {visibleEvents.length > 0 ? (
              <ol className="divide-y divide-[var(--color-border)]">
                {visibleEvents.map(event => {
                  const payload = event.payloadJson || {};
                  const title = payload.stepTitle || payload.title || payload.status || 'Event recorded';
                  const detail = payload.errorMessage ? `${title} · ${payload.errorMessage}` : title;
                  return (
                    <li key={event.sequence} className="flex min-w-0 items-baseline gap-1.5 py-1 text-xs" title={detail}>
                      <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">#{event.sequence} · Run {event.runIndex || 1}</span>
                      <span className="shrink-0 text-[var(--color-text-secondary)]">{event.type.replaceAll('_', ' ').toLowerCase()}</span>
                      <span className={`truncate ${payload.stepTitle || event.type.includes('STEP') ? 'font-mono' : ''} ${payload.errorMessage ? 'text-[var(--color-danger)]' : ''}`}>{detail}</span>
                    </li>
                  );
                })}
              </ol>
            ) : recentEvents.length === 0 && preparationLogs.length > 0 ? (
              <ol className="divide-y divide-[var(--color-border)]" aria-label="Preparation log">
                {preparationLogs.map(entry => (
                  <li key={entry.id} title={entry.message} className={`flex min-w-0 gap-2 py-1 text-xs ${entry.level === 'ERROR' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-secondary)]'}`}>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">{new Date(entry.time).toLocaleTimeString()}</span>
                    <span className="truncate">{entry.message}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="py-1 text-xs text-[var(--color-text-muted)]">No steps to show.</p>}
          </div>
        </details>
      </aside>
    </div>
  );
}

export default function SystemTestLiveRun({
  projectId,
  snapshotId,
  activeJobId,
  initialAssessmentId = null,
  completedJob = null,
  jobExecuting = false,
  specGroups = [],
  runningTests = false,
  onRunScenario = null,
}) {
  const access = useProjectAccess(projectId);
  const { userId } = useAuth();
  const [speed, setSpeed] = useState(() => {
    try {
      return localStorage.getItem(liveRunSpeedKey) === 'fast' ? 'fast' : 'watch';
    } catch {
      return 'watch';
    }
  });
  const [selectedCaseKey, setSelectedCaseKey] = useState('');
  const [jobActor, setJobActor] = useState(null);
  const [jobTestResult, setJobTestResult] = useState(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [assessment, setAssessment] = useState(null);
  const [storedEvents, setEvents] = useState([]);
  const received = useRef(new Set());
  const canvasRef = useRef(null);
  const lastStoredFrame = useRef(null);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);
  // Job log lines shown while the app is installed, started and tests prepared,
  // which can take minutes before Playwright emits its first event.
  const jobTerminal = useRef(false);
  const cursor = useRef(0);
  const runJobId = activeJobId || completedJob?.jobId;
  const assessmentId = initialAssessmentId ||
    (runJobId && assessment?.jobId === runJobId && assessment.snapshotId === snapshotId ? assessment.id : null);
  const currentAssessment = assessment?.id === assessmentId ? assessment : null;
  const currentJob = runJobId && jobActor?.jobId === runJobId ? jobActor : null;
  const currentJobStatus = completedJob?.status || (activeJobId
    ? currentJob?.status
    : currentAssessment?.status);
  const events = assessmentId && storedEvents[0]?.assessmentId === assessmentId ? storedEvents : [];
  const preparationLogs = currentJob?.logs || [];
  const liveState = deriveLiveRunState({ events, jobStatus: currentJobStatus });
  const isAllFinished = liveState.isTerminal;
  const mayStop = !!activeJobId && !accessRevoked && access.can('tests.run') && (access.role === 'OWNER' || (jobActor?.jobId === activeJobId && jobActor?.userId === userId));

  useEffect(() => {
    jobTerminal.current = isAllFinished;
  }, [isAllFinished]);

  useEffect(() => {
    if (!completedJob || assessmentId || completedJob.testStatus ||
      !['SUCCESS', 'COMPLETED'].includes(completedJob.status)) return;
    let current = true;
    getJobDetailApi(completedJob.jobId).then(response => {
      if (current) setJobTestResult({ jobId: completedJob.jobId, status: response.job?.result?.testRun?.status });
    }).catch(err => {
      if (current) console.error('[SystemTestLiveRun] Job result fetch failed:', err);
    });
    return () => { current = false; };
  }, [assessmentId, completedJob]);

  useEffect(() => {
    if (!activeJobId) return;
    let current = true;
    let timer;
    const poll = () => getJobDetailApi(activeJobId, { summary: true, includeLogs: true }).then(response => {
      if (!current) return;
      const job = response.job || response.data;
      const status = job?.status || 'RUNNING';
      const logs = (job?.logs || [])
        .filter(log => log.message && !/heartbeat|^Progress \d+%|Execution in progress \(elapsed/i.test(log.message))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(-40)
        .map(log => ({ id: log.id || `${log.createdAt}:${log.message}`, level: log.level, time: log.createdAt, message: log.message.replace(/^Assessment stage: /, '') }));
      setJobActor(previous => ({
        jobId: activeJobId,
        userId: job?.userId || null,
        status,
        logs,
        executing: (previous?.jobId === activeJobId && previous.executing) ||
          logs.some(log => /\bexecuting\b/i.test(log.message)),
      }));
      if (terminalJobStatuses.includes(status)) {
        clearInterval(timer);
      }
    }).catch(err => {
      console.error('[SystemTestLiveRun] Job status poll failed:', err);
    });
    poll();
    timer = setInterval(poll, 4000);
    return () => { current = false; clearInterval(timer); };
  }, [activeJobId]);

  // Resolve an assessment by its job when admission did not return an assessment ID.
  useEffect(() => {
    if (!activeJobId || assessmentId) return;
    let active = true;
    let timer;
    const resolveRecord = async () => {
      try {
        const record = await systemEvidenceRequest(snapshotId, 'assessments');
        if (!active) return;
        if (record?.jobId === activeJobId && record?.id) {
          setAssessment(assessmentState(record));
        } else {
          timer = setTimeout(resolveRecord, 1200);
        }
      } catch (err) {
        if (active) setError(err.response?.data?.message || err.message);
      }
    };

    resolveRecord();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [snapshotId, activeJobId, assessmentId]);

  // Event stream listener & polling replay
  useEffect(() => {
    let active = true;
    cursor.current = 0;
    received.current = new Set();
    lastStoredFrame.current = null;
    queueMicrotask(() => {
      if (!active) return;
      setEvents([]);
      setCheckpoint(null);
      setStopping(false);
      setAccessRevoked(false);
    });
    if (!assessmentId) return () => { active = false; };

    const merge = incoming => {
      if (!active || !incoming?.sequence) return;
      if (incoming.sequence <= cursor.current || received.current.has(incoming.sequence)) return;
      received.current.add(incoming.sequence);
      cursor.current = contiguousCursor(cursor.current, received.current);
      for (const sequence of received.current) if (sequence <= cursor.current) received.current.delete(sequence);
      setEvents(previous => {
        const next = [...previous, incoming].sort((a, b) => a.sequence - b.sequence);
        // Keep run and scenario milestones available after the step log reaches its limit.
        return next.slice(0, -300).filter(event => runEvent.test(event.type) || scenarioEvent.test(event.type)).concat(next.slice(-300));
      });
    };

    let replaying = false;
    let finalReplayDone = false;
    let socketFrameCount = 0;
    let socket = null;
    const replay = async () => {
      if (replaying || finalReplayDone) return;
      replaying = true;
      // One last replay after the job ends collects the closing events.
      const finishing = jobTerminal.current;
      try {
        let after = cursor.current;
        for (let page = 0; page < 10; page++) {
          const batch = await systemEvidenceRequest(
            snapshotId,
            `assessments/${assessmentId}/events?after=${after}&limit=100`
          );
          if (!active) return;
          batch.forEach(merge);
          if (batch.length < 100) break;
          after = batch.at(-1).sequence;
        }
        // Load the saved result at completion and use its frame if the socket missed it.
        if (finishing || !socketFrameCount || !socket?.connected) {
          const framesBeforePoll = socketFrameCount;
          const record = await systemEvidenceRequest(snapshotId, `assessments/${assessmentId}`).catch(err => {
            console.error('[SystemTestLiveRun] Assessment frame refresh failed:', err);
            return null;
          });
          if (!active) return;
          if (record) {
            setAssessment(assessmentState(record));
            if (framesBeforePoll === socketFrameCount &&
              (finishing || !socketFrameCount || !socket?.connected) && record.liveFrame &&
              (record.liveFrame !== lastStoredFrame.current?.frame || record.liveFrameUrl !== lastStoredFrame.current?.url)) {
              lastStoredFrame.current = { frame: record.liveFrame, url: record.liveFrameUrl };
              canvasRef.current?.push(record.liveFrame, undefined, record.liveFrameUrl);
            }
            if (finishing) finalReplayDone = true;
          }
        }
      } catch (err) {
        if (active) setError(err.response?.data?.message || err.message);
      } finally {
        replaying = false;
      }
    };

    replay();
    const intervalTimer = setInterval(replay, 1800);
    const token = getToken();
    socket = io(socketUrl, { auth: socketAuth });
    attachSocketAuthRecovery(socket);

    socket.on('connect', () => {
      if (projectId) socket.timeout(12000).emit('project:subscribe', { projectId }, (timeout, result) => {
        if (!active) return;
        if (timeout) { setError('Live updates are unavailable. Saved execution events continue to refresh.'); return; }
        if (!result?.ok) {
          active = false; clearInterval(intervalTimer);
          setAccessRevoked(true); setEvents([]); canvasRef.current?.clear(); setCheckpoint(null);
          lastStoredFrame.current = null;
          setError('Project access unavailable. Reopen the project to check your access.');
          socket.disconnect();
          return;
        }
        setError('');
      });
      try {
        const userId = JSON.parse(atob(token.split('.')[1])).userId;
        if (userId) socket.emit('subscribe_notifications', userId);
      } catch {
        /* Replay fallback continues */
      }
      replay();
    });
    socket.on('project:access-changed', event => {
      if (event.projectId !== projectId || !event.revoked) return;
      active = false; clearInterval(intervalTimer);
      setAccessRevoked(true); setEvents([]); canvasRef.current?.clear(); setCheckpoint(null);
      lastStoredFrame.current = null;
      setError('Your access to this project has been removed.');
      socket.disconnect();
    });

    socket.on('system-run:event', event => {
      if (event.snapshotId === snapshotId && (!assessmentId || event.assessmentId === assessmentId)) {
        merge(event);
      }
    });

    socket.on('system-run:frame', event => {
      if (active && event.snapshotId === snapshotId && event.assessmentId === assessmentId && event.frame) {
        socketFrameCount++;
        canvasRef.current?.push(event.frame, event.mime, event.url);
      }
    });

    return () => {
      active = false;
      clearInterval(intervalTimer);
      if (projectId) socket.emit('project:unsubscribe', { projectId });
      socket.disconnect();
    };
  }, [projectId, snapshotId, assessmentId]);

  // Resolve screenshot checkpoint & active scenario
  const currentScenario = events.findLast(event => event.type === 'SCENARIO_STARTED' &&
    Number(event.runIndex || 1) === liveState.activeRunIndex);
  const scenarioStarted = events.some(event => event.type === 'SCENARIO_STARTED');
  const latestPreparationStep = preparationLogs.findLast(log => !/^\[(DockerRunner|AUT Healthcheck)\]/.test(log.message));
  const executionStep = preparationLogs.findLast(log => /\bexecuting\b/i.test(log.message));
  const latestArtifact = events.findLast(event => event.payloadJson?.artifactId);
  const artifactId = latestArtifact?.payloadJson?.artifactId;

  useEffect(() => {
    if (!artifactId || !snapshotId) return;
    const controller = new AbortController();
    let objectUrl;

    getSystemRunArtifact(snapshotId, artifactId, { signal: controller.signal })
      .then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setCheckpoint({
          artifactId,
          url: objectUrl,
          title: latestArtifact.payloadJson?.title || currentScenario?.payloadJson?.title,
          time: new Date().toLocaleTimeString(),
        });
      })
      .catch(err => {
        if (!controller.signal.aborted) setError(err.response?.data?.message || err.message);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [snapshotId, artifactId, latestArtifact?.payloadJson?.title, currentScenario?.payloadJson?.title]);

  const handleStopRun = async () => {
    if (!mayStop || !activeJobId || stopping || isAllFinished) return;
    setStopping(true);
    try {
      await cancelJobApi(activeJobId);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setStopping(false);
    }
  };

  const changeSpeed = nextSpeed => {
    setSpeed(nextSpeed);
    try {
      localStorage.setItem(liveRunSpeedKey, nextSpeed);
    } catch {
      // Keep the selected speed for this session.
    }
  };

  // Live Run executes on the real stack only: frontend-only specs (API mocks) cannot run here.
  const liveScenarios = [];
  const frontendOnlySpecs = (specGroups || []).filter(g => g.fullStackCompatible === false && g.filePath);
  for (const g of specGroups || []) {
    if (g.fullStackCompatible === false) continue;
    for (const sc of g.scenarios || []) {
      const title = sc.title || sc.testName;
      if (!title || sc.origin === 'AI_DRAFT') continue;
      liveScenarios.push({
        key: `${g.filePath}::${title}`,
        filePath: sc.testFile || g.filePath,
        title,
        status: sc.status,
        group: g,
        scenario: sc,
      });
    }
  }
  const activeSelectedCase =
    liveScenarios.find((item) => item.key === selectedCaseKey) || liveScenarios[0] || null;

  const run = summarizeScenarios(events, liveState.activeRunIndex || 1);
  const testStatus = completedJob?.testStatus ||
    (runJobId && jobTestResult?.jobId === runJobId ? jobTestResult.status : null);
  const failed = currentAssessment?.failed ?? (testStatus === 'FAILED' || events.some(event => (
    event.type === 'SCENARIO_FAILED'
    || (['SCENARIO_ENDED', 'RUN_ENDED'].includes(event.type) && event.payloadJson?.status?.toUpperCase() === 'FAILED')
  )));
  const hasResult = currentAssessment?.failed !== undefined || testStatus || failed ||
    events.some(event => event.type === 'RUN_ENDED' && event.payloadJson?.status);
  let status = 'Idle';
  let statusVariant = 'secondary';
  let stage = 'Select a test case to run.';
  if (!accessRevoked) {
    if (isAllFinished) {
      if (['CANCELED', 'CANCELLED'].includes(currentJobStatus)) {
        status = 'Stopped';
        stage = 'Run canceled';
      } else if (currentJobStatus === 'FAILED') {
        status = 'Error';
        statusVariant = 'danger';
        stage = 'The job failed';
      } else if (hasResult) {
        status = failed ? 'Failed' : 'Passed';
        statusVariant = failed ? 'danger' : 'success';
        stage = 'Assessment complete';
      } else {
        status = null;
        stage = 'Loading the run result';
      }
    } else if (runningTests || activeJobId) {
      if (activeJobId && (scenarioStarted || currentJob?.executing || jobExecuting)) {
        status = 'Running';
        statusVariant = 'default';
        stage = run.rows.findLast(row => row.status === 'running')?.title || currentScenario?.payloadJson?.title ||
          executionStep?.message || 'Running scenarios';
      } else {
        status = 'Preparing';
        statusVariant = 'warning';
        stage = 'Preparing: ' + (latestPreparationStep?.message || 'Starting the test environment');
      }
    }
  }
  const live = status === 'Preparing' || status === 'Running';
  if (stopping && live) stage = 'Stopping the run';

  return (
    <section className="min-w-0 space-y-3" aria-label="Live Playwright execution">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 max-w-full flex-1 basis-52 items-center gap-2">
          {status && <Badge variant={statusVariant} role="status">{status}</Badge>}
          <Hint text={stage}>
            <span tabIndex={0} className="min-w-0 truncate text-xs text-[var(--color-text-secondary)]">{stage}</span>
          </Hint>
        </div>

        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {onRunScenario && liveScenarios.length > 0 && access.can('tests.run') && (
            <>
              <select
                aria-label="Test case"
                value={activeSelectedCase?.key || ''}
                onChange={event => setSelectedCaseKey(event.target.value)}
                disabled={runningTests}
                className="h-8 min-w-0 max-w-full truncate rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus-visible:border-[var(--color-primary)] disabled:opacity-50 sm:max-w-[260px]"
              >
                {liveScenarios.map(item => (
                  <option key={item.key} value={item.key}>{item.filePath} › {item.title}</option>
                ))}
              </select>
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                <span>Speed:</span>
                <div role="group" aria-label="Run speed" className="inline-flex rounded-md border border-[var(--color-border)] p-0.5">
                  {['watch', 'fast'].map(option => (
                    <Button
                      key={option}
                      type="button"
                      size="sm"
                      variant={speed === option ? 'secondary' : 'ghost'}
                      className="h-6 px-2 text-xs"
                      aria-pressed={speed === option}
                      onClick={() => changeSpeed(option)}
                    >
                      {option === 'watch' ? 'Watch' : 'Fast'}
                    </Button>
                  ))}
                </div>
              </div>
              <Button
                size="sm"
                disabled={runningTests || !activeSelectedCase}
                onClick={() => activeSelectedCase && onRunScenario(activeSelectedCase.scenario, activeSelectedCase.group, speed === 'watch')}
                title="Run selected test case live"
              >
                <Play aria-hidden="true" />
                Run
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!mayStop || stopping || isAllFinished}
            onClick={handleStopRun}
            className="border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
          >
            {stopping ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Square aria-hidden="true" />}
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        </div>
      </div>

      {frontendOnlySpecs.length > 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {liveScenarios.length === 0
            ? 'No test case can run on the real stack yet: your specs mock the API. Generate Full Stack tests, review and apply them to run them live.'
            : `${frontendOnlySpecs.length} frontend-only spec${frontendOnlySpecs.length > 1 ? 's' : ''} (API mocks) hidden — they can't run on the real stack.`}
        </p>
      )}

      {run.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div
            role="progressbar"
            aria-label="Scenario progress"
            aria-valuenow={run.passed + run.failed}
            aria-valuemin={0}
            aria-valuemax={run.total}
            className="flex h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-secondary)]"
          >
            <div className="bg-emerald-500" style={{ width: (100 * run.passed / run.total) + '%' }} />
            <div className="bg-[var(--color-danger)]" style={{ width: (100 * run.failed / run.total) + '%' }} />
          </div>
          <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">
            {run.passed} passed · {run.failed} failed · {run.total} total
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
          <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-12">
        <BrowserViewer
          key={assessmentId || runJobId || snapshotId}
          canvasRef={canvasRef}
          checkpoint={checkpoint?.artifactId === artifactId ? checkpoint : null}
          live={live}
          ended={isAllFinished && !accessRevoked}
        />
        <RunScenarios scenarios={run.rows} events={events} preparationLogs={preparationLogs} finished={isAllFinished} />
      </div>
    </section>
  );
}
