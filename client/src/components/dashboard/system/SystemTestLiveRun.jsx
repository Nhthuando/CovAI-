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

export default function SystemTestLiveRun({ projectId, snapshotId, activeJobId, initialAssessmentId = null }) {
  const access = useProjectAccess(projectId);
  const { userId } = useAuth();
  const [jobActor, setJobActor] = useState(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [assessmentId, setAssessmentId] = useState(initialAssessmentId);
  const [events, setEvents] = useState([]);
  const [liveFrame, setLiveFrame] = useState(null);
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);
  const cursor = useRef(0);
  const terminalBottomRef = useRef(null);
  const mayStop = !!activeJobId && !accessRevoked && access.can('tests.run') && (access.role === 'OWNER' || (jobActor?.jobId === activeJobId && jobActor?.userId === userId));

  useEffect(() => {
    if (!activeJobId) return;
    let current = true;
    getJobDetailApi(activeJobId).then(response => {
      if (current) setJobActor({ jobId: activeJobId, userId: (response.job || response.data)?.userId || null });
    }).catch(() => { if (current) setJobActor(null); });
    return () => { current = false; };
  }, [activeJobId]);

  // Poll / resolve assessment record if not passed as prop
  useEffect(() => {
    let active = true;
    cursor.current = 0;
    if (initialAssessmentId) {
      queueMicrotask(() => {
        if (active) setAssessmentId(initialAssessmentId);
      });
    }
    if (!activeJobId) return () => { active = false; };

    let timer;
    const resolveRecord = async () => {
      try {
        const record = await systemEvidenceRequest(snapshotId, 'assessments');
        if (!active) return;
        if (record?.jobId === activeJobId && record.id) {
          setAssessmentId(record.id);
        } else if (!assessmentId) {
          timer = setTimeout(resolveRecord, 1500);
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
  }, [snapshotId, activeJobId, initialAssessmentId, assessmentId]);

  // Event stream listener & polling replay
  useEffect(() => {
    if (!assessmentId) return;
    let active = true;

    const merge = incoming => {
      if (!active || !incoming?.sequence) return;
      setEvents(previous => {
        if (previous.some(event => event.sequence === incoming.sequence)) return previous;
        cursor.current = Math.max(cursor.current, incoming.sequence);
        const next = [...previous, incoming].sort((a, b) => a.sequence - b.sequence);
        return next.slice(-300);
      });
    };

    const replay = async () => {
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
      } catch (err) {
        if (active) setError(err.response?.data?.message || err.message);
      }
    };

    replay();
    const intervalTimer = setInterval(replay, 3500);
    const token = getToken();
    const socket = io(socketUrl, { auth: { token } });

    socket.on('connect', () => {
      if (projectId) socket.timeout(5000).emit('project:subscribe', { projectId }, (timeout, result) => {
        if (!active) return;
        if (timeout) { setError('Live updates are unavailable. Saved execution events continue to refresh.'); return; }
        if (!result?.ok) {
          active = false; clearInterval(intervalTimer);
          setAccessRevoked(true); setEvents([]); setLiveFrame(null); setCheckpoint(null);
          setError('Project access unavailable. Reopen the project to check your access.');
          socket.disconnect();
        }
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
      if (event.snapshotId === snapshotId && event.assessmentId === assessmentId) {
        merge(event);
      }
    });

    socket.on('system-run:frame', event => {
      if (event.snapshotId === snapshotId && event.frame) {
        setLiveFrame(`data:image/jpeg;base64,${event.frame}`);
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
    if (terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, [events.length]);

  // Resolve screenshot checkpoint & active scenario
  const runEndedEvent = events.find(event => ['RUN_ENDED', 'RUN_CANCELED'].includes(event.type));
  const latestScenarioStart = [...events].reverse().find(event => event.type === 'SCENARIO_STARTED');
  const latestScenarioEnd = [...events].reverse().find(event => event.type === 'SCENARIO_ENDED');
  const isScenarioActive = latestScenarioStart && (!latestScenarioEnd || latestScenarioEnd.sequence < latestScenarioStart.sequence);
  const isAllFinished = Boolean(runEndedEvent);

  const activeScenarioTitle = isAllFinished
    ? 'All Scenarios Completed'
    : !isScenarioActive && latestScenarioEnd
    ? `${latestScenarioEnd.payloadJson?.title || 'Scenario'} — Completed`
    : (latestScenarioStart?.payloadJson?.title || 'Initializing Scenario Runner...');
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
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm dark:shadow-xl overflow-hidden font-sans"
      aria-label="Live Playwright Execution View"
    >
      {/* Top Header Bar */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-blue-500/10 via-[var(--color-surface)] to-[var(--color-surface)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative flex h-3.5 w-3.5 shrink-0">
            {isScenarioActive && !isAllFinished && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
              isAllFinished || (!isScenarioActive && latestScenarioEnd)
                ? 'bg-emerald-600'
                : 'bg-blue-600'
            }`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-bold text-[var(--color-text)] tracking-wide flex items-center gap-2">
                <Monitor size={17} className="text-blue-600 dark:text-blue-400" />
                Playwright Live Runner
              </h2>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                isAllFinished
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  : !isScenarioActive && latestScenarioEnd
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  : 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30'
              }`}>
                {isAllFinished ? 'FINISHED' : !isScenarioActive && latestScenarioEnd ? 'SCENARIO COMPLETED' : 'RUNNING'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 min-w-0">
              <span className="text-xs uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-400 shrink-0">
                Running Scenario:
              </span>
              <span className="text-xs font-bold text-[var(--color-text)] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-3 py-0.5 rounded-md truncate max-w-xl shadow-xs font-mono">
                {activeScenarioTitle}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!mayStop || stopping || !activeJobId || isAllFinished}
          onClick={handleStopRun}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          {stopping ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Stopping…
            </>
          ) : (
            <>
              <Square size={13} fill="currentColor" />
              Stop Run
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="px-5 py-2.5 bg-rose-50 dark:bg-rose-500/10 border-b border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid: Browser Viewport & Event Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)]">
        {/* Left Column: Simulated Browser Viewport */}
        <div className="lg:col-span-8 p-4 sm:p-5 flex flex-col justify-between bg-slate-50/70 dark:bg-zinc-950/40 min-h-[500px]">
          <div>
            {/* Browser Window Chrome */}
            <div className="rounded-t-xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-4 py-2.5 flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-rose-500 inline-block shadow-xs" />
                <span className="h-3 w-3 rounded-full bg-amber-500 inline-block shadow-xs" />
                <span className="h-3 w-3 rounded-full bg-emerald-500 inline-block shadow-xs" />
              </div>
              <div className="flex-1 max-w-md mx-auto px-3 py-1 rounded-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-xs font-mono text-slate-700 dark:text-zinc-300 truncate text-center shadow-xs">
                http://localhost:5173/ (Chromium)
              </div>
            </div>

            {/* Viewport Screen: Edge-to-edge 16:9 full viewport with zero side bars */}
            <div className="rounded-b-xl border-x border-b border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-950 relative overflow-hidden aspect-video flex items-center justify-center">
              {liveFrame ? (
                <div className="relative w-full h-full bg-slate-900 flex items-center justify-center">
                  <img
                    src={liveFrame}
                    alt="Playwright Real-time Live Stream"
                    className="w-full h-full object-cover block"
                  />
                  <div className={`absolute top-3 right-3 px-3 py-1 rounded-md text-white text-xs font-mono font-bold flex items-center gap-2 shadow-lg border ${
                    isAllFinished || (!isScenarioActive && latestScenarioEnd)
                      ? 'bg-emerald-600/95 border-emerald-400/40'
                      : 'bg-blue-600/95 border-blue-400/40'
                  }`}>
                    <span className={`h-2 w-2 rounded-full bg-white ${isAllFinished || (!isScenarioActive && latestScenarioEnd) ? '' : 'animate-pulse'}`} />
                    {isAllFinished ? 'ALL FINISHED' : !isScenarioActive && latestScenarioEnd ? 'SCENARIO FINISHED' : 'LIVE 30FPS'}
                  </div>
                </div>
              ) : checkpoint?.url ? (
                <div className="relative w-full h-full bg-slate-900 flex items-center justify-center">
                  <img
                    src={checkpoint.url}
                    alt={`Browser checkpoint: ${checkpoint.title || 'Scenario execution'}`}
                    className="w-full h-full object-cover block"
                  />
                  <div className="absolute bottom-2 left-2 right-2 px-3 py-1.5 rounded-md bg-slate-900/90 backdrop-blur-md text-xs text-slate-200 font-mono flex items-center justify-between border border-slate-800">
                    <span className="truncate">Captured: {checkpoint.title || 'Current Step'}</span>
                    <span className="shrink-0 text-slate-400">{checkpoint.time}</span>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center space-y-3 bg-white dark:bg-zinc-950">
                  <div className="inline-flex p-3.5 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-xs">
                    <Activity size={28} className="animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-zinc-100">
                      {activeScenarioTitle}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                      Streaming real-time browser actions, mouse cursor, and live assertions.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-text-secondary)] font-mono">
            <span className="flex items-center gap-1.5">
              <Layers size={14} className="text-blue-600 dark:text-blue-400" />
              Target: <strong className="text-[var(--color-text)]">{activeScenarioTitle}</strong>
            </span>
            <span className="text-[var(--color-text-muted)] font-sans text-xs">Live Checkpoints Active</span>
          </div>
        </div>

        {/* Right Column: Execution Events Log Stream */}
        <div className="lg:col-span-4 p-4 sm:p-5 flex flex-col bg-white dark:bg-zinc-950">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-zinc-800 mb-3 shrink-0">
            <span className="text-xs font-mono font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-2">
              <Terminal size={15} className="text-blue-600 dark:text-blue-400" />
              Event Stream ({events.length})
            </span>
            <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-400">Auto-tail</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs select-text min-h-[360px] max-h-[580px]">
            {events.length === 0 ? (
              <div className="py-16 text-center text-slate-500 dark:text-zinc-400 space-y-2">
                <Loader2 size={18} className="animate-spin mx-auto text-blue-600 dark:text-blue-400" />
                <p>Waiting for first test event…</p>
              </div>
            ) : (
              events.map((event) => {
                const isPassed = event.payloadJson?.status === 'PASSED' || event.type === 'SCENARIO_PASSED';
                const isFailed = event.payloadJson?.status === 'FAILED' || event.type === 'SCENARIO_FAILED';
                const isStarted = event.type === 'SCENARIO_STARTED' || event.type === 'RUN_STARTED';

                return (
                  <div
                    key={event.sequence}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700 transition-colors shadow-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
                      <span className="font-semibold">#{event.sequence} · Run {event.runIndex || 1}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold uppercase tracking-wider border ${
                        isPassed
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : isFailed
                          ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          : isStarted
                          ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                          : 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300 border-slate-200 dark:border-zinc-700'
                      }`}>
                        {event.type.replaceAll('_', ' ')}
                      </span>
                    </div>

                    <div className="mt-2 flex items-start gap-2.5">
                      {isPassed && <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
                      {isFailed && <XCircle size={15} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
                      {isStarted && <Play size={13} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 fill-blue-600 dark:fill-blue-400" />}

                      <div className="min-w-0 flex-1">
                        <span className="block text-slate-900 dark:text-zinc-100 font-medium text-xs break-words">
                          {event.payloadJson?.stepTitle ||
                            event.payloadJson?.title ||
                            event.payloadJson?.status ||
                            'Event recorded'}
                        </span>

                        {event.payloadJson?.errorMessage && (
                          <span className="block text-xs text-rose-800 dark:text-rose-300 mt-1.5 break-all bg-rose-50 dark:bg-rose-950/50 p-2 rounded border border-rose-200 dark:border-rose-800/60 font-mono">
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
