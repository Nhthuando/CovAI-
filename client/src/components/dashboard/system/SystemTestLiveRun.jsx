import { attachSocketAuthRecovery, socketAuth } from "../../../lib/authSession.js";
import { deriveLiveRunState, contiguousCursor } from './systemLiveRunModel.js';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Monitor,
  Terminal,
  Square,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  AlertCircle,
  Play,
  Layers,
} from 'lucide-react';
import { systemEvidenceRequest, getSystemRunArtifact } from '../../../services/systemTest.service.js';
import { cancelJobApi, getJobDetailApi } from '../../../services/job.service.js';
import { useProjectAccess } from '../../../hooks/useProjectAccess';
import { useAuth } from '../../../hooks/useAuth';

const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
const getToken = () => {
  try {
    return localStorage.getItem('token') || JSON.parse(localStorage.getItem('user') || 'null')?.token;
  } catch {
    return localStorage.getItem('token');
  }
};

const toFrameDataUri = frame => {
  if (!frame || typeof frame !== 'string') return null;
  if (frame.startsWith('data:image/')) return frame;
  const mime = frame.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${frame}`;
};

export default function SystemTestLiveRun({ projectId, snapshotId, activeJobId, initialAssessmentId = null }) {
  const access = useProjectAccess(projectId);
  const { userId } = useAuth();
  const [jobActor, setJobActor] = useState(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [assessmentId, setAssessmentId] = useState(initialAssessmentId);
  const [events, setEvents] = useState([]);
  const [jobStatus, setJobStatus] = useState('RUNNING');
  const received = useRef(new Set());
  const [liveFrame, setLiveFrame] = useState(null);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);
  // Job log lines shown while the app is installed, started and tests prepared,
  // which can take minutes before Playwright emits its first event.
  const [preparationLogs, setPreparationLogs] = useState([]);
  const jobTerminal = useRef(false);
  const cursor = useRef(0);
  const terminalBottomRef = useRef(null);
  const followsLatest = useRef(true);
  const mayStop = !!activeJobId && !accessRevoked && access.can('tests.run') && (access.role === 'OWNER' || (jobActor?.jobId === activeJobId && jobActor?.userId === userId));

  useEffect(() => {
    if (!activeJobId) return;
    let current = true;
    let timer;
    const poll = () => getJobDetailApi(activeJobId).then(response => {
      if (!current) return;
      const job = response.job || response.data;
      const status = job?.status || 'RUNNING';
      setJobStatus(status);
      setJobActor({ jobId: activeJobId, userId: job?.userId || null });
      setPreparationLogs((job?.logs || [])
        .filter(log => log.message && !/heartbeat|^Progress \d+%|Execution in progress \(elapsed/i.test(log.message))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(-40)
        .map(log => ({ id: log.id || `${log.createdAt}:${log.message}`, level: log.level, time: log.createdAt, message: log.message.replace(/^Assessment stage: /, '') })));
      if (['SUCCESS', 'COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED'].includes(status)) {
        jobTerminal.current = true;
        clearInterval(timer);
      }
    }).catch(err => {
      console.error('[SystemTestLiveRun] Job status poll failed:', err);
      if (current) setJobActor(null);
    });
    jobTerminal.current = false;
    poll();
    timer = setInterval(poll, 2500);
    return () => { current = false; clearInterval(timer); };
  }, [activeJobId]);

  // Poll / resolve assessment record if not passed as prop
  useEffect(() => {
    let active = true;
    cursor.current = 0;
    received.current = new Set();
    queueMicrotask(() => {
      if (active) {
        setEvents([]);
        setLiveFrame(null);
        setCheckpoint(null);
        setStopping(false);
        setAccessRevoked(false);
        setPreparationLogs([]);
        setAssessmentId(initialAssessmentId || null);
      }
    });
    if (!activeJobId && !initialAssessmentId) return () => { active = false; };

    let timer;
    const resolveRecord = async () => {
      try {
        const record = await systemEvidenceRequest(snapshotId, 'assessments');
        if (!active) return;
        if ((record?.jobId === activeJobId || (!activeJobId && record?.id === initialAssessmentId)) && record?.id) {
          if (record.liveFrame) setLiveFrame(toFrameDataUri(record.liveFrame));
          setAssessmentId(record.id);
        } else if (activeJobId) {
          timer = setTimeout(resolveRecord, 1200);
        }
      } catch (err) {
        if (active) setError(err.response?.data?.message || err.message);
      }
    };

    if (!initialAssessmentId) resolveRecord();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [snapshotId, activeJobId, initialAssessmentId]);

  // Event stream listener & polling replay
  useEffect(() => {
    if (!assessmentId) return;
    let active = true;

    const merge = incoming => {
      if (!active || !incoming?.sequence) return;
      setEvents(previous => {
        if (previous.some(event => event.sequence === incoming.sequence)) return previous;
        received.current.add(incoming.sequence);
        cursor.current = contiguousCursor(cursor.current, received.current);
        for (const sequence of received.current) if (sequence <= cursor.current) received.current.delete(sequence);
        const next = [...previous, incoming].sort((a, b) => a.sequence - b.sequence);
        return next.slice(-300);
      });
    };

    let replaying = false;
    let finalReplayDone = false;
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
        // Frames arrive over the socket; read the stored frame only as a fallback.
        if (!socket?.connected) {
          const record = await systemEvidenceRequest(snapshotId, `assessments/${assessmentId}`).catch(err => {
            console.error('[SystemTestLiveRun] Assessment frame refresh failed:', err);
            return null;
          });
          if (active && record?.liveFrame) setLiveFrame(toFrameDataUri(record.liveFrame));
        }
        if (finishing) finalReplayDone = true;
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
          setAccessRevoked(true); setEvents([]); setLiveFrame(null); setCheckpoint(null);
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
      setAccessRevoked(true); setEvents([]); setLiveFrame(null); setCheckpoint(null);
      setError('Your access to this project has been removed.');
      socket.disconnect();
    });

    socket.on('system-run:event', event => {
      if (event.snapshotId === snapshotId && (!assessmentId || event.assessmentId === assessmentId)) {
        merge(event);
      }
    });

    socket.on('system-run:frame', event => {
      if (event.snapshotId === snapshotId && (!assessmentId || event.assessmentId === assessmentId) && event.frame) {
        setLiveFrame(toFrameDataUri(event.frame));
      }
    });

    return () => {
      active = false;
      clearInterval(intervalTimer);
      if (projectId) socket.emit('project:unsubscribe', { projectId });
      socket.disconnect();
    };
  }, [projectId, snapshotId, assessmentId]);

  // Synchronized auto-scroll the terminal on new events without sluggish animation
  useEffect(() => {
    if (followsLatest.current && terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, [events.length]);

  // Resolve screenshot checkpoint & active scenario
  const liveState = deriveLiveRunState({events, jobStatus});
  const latestScenarioStart = [...events].reverse().find(event => event.type === 'SCENARIO_STARTED');
  const latestScenarioEnd = [...events].reverse().find(event => event.type === 'SCENARIO_ENDED');
  const isScenarioActive = latestScenarioStart && (!latestScenarioEnd || latestScenarioEnd.sequence < latestScenarioStart.sequence);
  const isAllFinished = liveState.isTerminal;

  const isPreparing = !isAllFinished && !latestScenarioStart;
  const latestPreparationStep = [...preparationLogs].reverse().find(log => !/^\[(DockerRunner|AUT Healthcheck)\]/.test(log.message));
  const activeScenarioTitle = isAllFinished
    ? `Assessment ${jobStatus.toLowerCase()}`
    : !isScenarioActive && latestScenarioEnd
    ? `${latestScenarioEnd.payloadJson?.title || 'Scenario'} — Completed`
    : (latestScenarioStart?.payloadJson?.title || latestPreparationStep?.message || 'Starting the test environment...');
  const currentScenario = latestScenarioStart;
  const latestArtifact = [...events].reverse().find(event => event.payloadJson?.artifactId);
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

  return (
    <section
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden font-sans"
      aria-label="Live Playwright Execution View"
    >
      {/* Top Header Bar */}
      <div className="px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative flex h-2.5 w-2.5 shrink-0">
            {isScenarioActive && !isAllFinished && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-primary)] opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
              isAllFinished || (!isScenarioActive && latestScenarioEnd)
                ? 'bg-emerald-500/80'
                : 'bg-[var(--color-primary)]'
            }`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
                <Monitor size={15} className="text-[var(--color-primary)]" />
                Playwright Live Runner
              </h2>
              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-mono font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                {isAllFinished ? 'Finished' : !isScenarioActive && latestScenarioEnd ? 'Scenario completed' : 'Running'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 min-w-0">
              <span className="text-[11px] font-medium text-[var(--color-text-muted)] shrink-0">
                {isPreparing ? 'Preparing:' : 'Running scenario:'}
              </span>
              <span className="text-xs font-medium text-[var(--color-text)] bg-[var(--color-bg)] border border-[var(--color-border)] px-2.5 py-0.5 rounded truncate max-w-xl font-mono">
                {activeScenarioTitle}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!mayStop || stopping || !activeJobId || isAllFinished}
          onClick={handleStopRun}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-500/30 bg-rose-500/[0.07] text-rose-400 hover:bg-rose-500/15 text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-45"
        >
          {stopping ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Stopping…
            </>
          ) : (
            <>
              <Square size={12} fill="currentColor" />
              Stop Run
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-rose-500/[0.06] border-b border-[var(--color-border)] border-l-2 border-l-rose-400/75 text-rose-300/90 text-xs flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid: Browser Viewport & Event Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)]">
        {/* Left Column: Simulated Browser Viewport */}
        <div className="lg:col-span-8 p-4 flex flex-col justify-between bg-[var(--color-bg)] min-h-[500px]">
          <div>
            {/* Browser Window Chrome */}
            <div className="rounded-t-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] px-3.5 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-text-muted)]">
                <Monitor size={12} />
                <span>Chromium Sandbox</span>
              </div>
              <div className="flex-1 max-w-md mx-auto px-3 py-1 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-secondary)] truncate text-center">
                Isolated test browser (Chromium)
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted)] shrink-0">
                16:9
              </div>
            </div>

            {/* Viewport Screen: Edge-to-edge 16:9 full viewport with zero side bars */}
            <div className="rounded-b-lg border-x border-b border-[var(--color-border)] bg-[var(--color-surface)] relative overflow-hidden aspect-video flex items-center justify-center">
              {liveFrame ? (
                <div className="relative w-full h-full bg-[#0b0f14] flex items-center justify-center">
                  <img
                    src={liveFrame}
                    alt="Playwright Real-time Live Stream"
                    className="w-full h-full object-cover block"
                  />
                  <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-[var(--color-surface)]/95 text-[var(--color-text)] text-[11px] font-mono font-medium flex items-center gap-1.5 border border-[var(--color-border)]">
                    <span className={`h-1.5 w-1.5 rounded-full ${isAllFinished || (!isScenarioActive && latestScenarioEnd) ? 'bg-emerald-500/85' : 'bg-[var(--color-primary)] animate-pulse'}`} />
                    {isAllFinished ? 'ALL FINISHED' : !isScenarioActive && latestScenarioEnd ? 'SCENARIO FINISHED' : `RUN ${liveState.activeRunIndex} OF 2`}
                  </div>
                </div>
              ) : checkpoint?.url ? (
                <div className="relative w-full h-full bg-[#0b0f14] flex items-center justify-center">
                  <img
                    src={checkpoint.url}
                    alt={`Browser checkpoint: ${checkpoint.title || 'Scenario execution'}`}
                    className="w-full h-full object-cover block"
                  />
                  <div className="absolute bottom-2 left-2 right-2 px-3 py-1.5 rounded-md bg-[var(--color-surface)]/95 text-[11px] text-[var(--color-text)] font-mono flex items-center justify-between border border-[var(--color-border)]">
                    <span className="truncate">Captured: {checkpoint.title || 'Current Step'}</span>
                    <span className="shrink-0 text-[var(--color-text-muted)] tabular-nums">{checkpoint.time}</span>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center space-y-3 bg-[var(--color-surface)]">
                  <div className="inline-flex p-2.5 rounded-lg bg-[var(--color-surface-secondary)] text-[var(--color-primary)] border border-[var(--color-border)]">
                    <Activity size={24} className="animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">
                      {activeScenarioTitle}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-md">
                      {isPreparing
                        ? 'Installing dependencies and starting the application. The browser view appears when the first scenario starts.'
                        : 'Streaming real-time browser actions, screenshots, and live assertions.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-text-secondary)] font-mono">
            <span className="flex items-center gap-1.5 truncate">
              <Layers size={13} className="text-[var(--color-text-muted)] shrink-0" />
              Target: <strong className="font-medium text-[var(--color-text)] truncate">{activeScenarioTitle}</strong>
            </span>
            <span className="text-[var(--color-text-muted)] font-sans text-xs shrink-0">Live checkpoints active</span>
          </div>
        </div>

        {/* Right Column: Execution Events Log Stream */}
        <div className="lg:col-span-4 p-4 flex flex-col bg-[var(--color-surface)]">
          <div className="flex items-center justify-between pb-2.5 border-b border-[var(--color-border)] mb-3 shrink-0">
            <span className="text-xs font-mono font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Terminal size={14} className="text-[var(--color-text-muted)]" />
              Event Stream ({events.length})
            </span>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)]">Auto-tail</span>
          </div>

          <div onScroll={(event) => { const node = event.currentTarget; followsLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }} className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs select-text min-h-[360px] max-h-[580px]">
            {events.length === 0 ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  {isAllFinished ? <AlertCircle size={14} className="shrink-0" /> : <Loader2 size={14} className="animate-spin shrink-0 text-[var(--color-primary)]" />}
                  {isAllFinished ? 'No test events were recorded for this run.' : 'Waiting for first test event…'}
                </p>
                {preparationLogs.length > 0 && (
                  <ol aria-label="Preparation log" className="space-y-1.5 border-l border-[var(--color-border)] pl-3">
                    {preparationLogs.map(log => (
                      <li key={log.id} className={`break-words leading-relaxed ${log.level === 'ERROR' ? 'text-rose-400' : 'text-[var(--color-text-secondary)]'}`}>
                        <span className="mr-2 tabular-nums text-[var(--color-text-muted)]">{new Date(log.time).toLocaleTimeString()}</span>
                        {log.message}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              events.map((event) => {
                const isPassed = event.payloadJson?.status === 'PASSED' || event.type === 'SCENARIO_PASSED';
                const isFailed = event.payloadJson?.status === 'FAILED' || event.type === 'SCENARIO_FAILED';
                const isStarted = event.type === 'SCENARIO_STARTED' || event.type === 'RUN_STARTED';

                return (
                  <div
                    key={event.sequence}
                    className="p-2.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors duration-150"
                  >
                    <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
                      <span className="font-medium tabular-nums">#{event.sequence} · Run {event.runIndex || 1}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                        isPassed
                          ? 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
                          : isFailed
                          ? 'bg-rose-500/[0.07] text-rose-300/90 border-rose-500/25'
                          : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
                      }`}>
                        {event.type.replaceAll('_', ' ')}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-start gap-2">
                      {isPassed && <CheckCircle2 size={14} className="text-emerald-500/80 shrink-0 mt-0.5" />}
                      {isFailed && <XCircle size={14} className="text-rose-400/90 shrink-0 mt-0.5" />}
                      {isStarted && <Play size={12} className="text-[var(--color-primary)] shrink-0 mt-0.5" />}

                      <div className="min-w-0 flex-1">
                        <span className="block text-[var(--color-text)] font-medium text-xs break-words">
                          {event.payloadJson?.stepTitle ||
                            event.payloadJson?.title ||
                            event.payloadJson?.status ||
                            'Event recorded'}
                        </span>

                        {event.payloadJson?.errorMessage && (
                          <span className="block text-[11px] text-rose-300/90 mt-1.5 break-all bg-rose-500/[0.06] p-2 rounded border border-rose-500/20 font-mono">
                            {event.payloadJson.errorMessage}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={terminalBottomRef} />
          </div>
        </div>
      </div>
    </section>
  );
}
