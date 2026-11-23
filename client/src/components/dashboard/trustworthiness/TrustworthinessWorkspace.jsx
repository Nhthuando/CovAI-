import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../ui/button';
import { Skeleton } from '../../common/Skeleton';
import { useTrustworthinessQuery, evaluationKey } from '../../../hooks/useTrustworthinessQuery';
import { useEvaluationSocket } from '../../../hooks/useEvaluationSocket';
import { useAuth } from '../../../hooks/useAuth';
import { evaluationRequest } from '../../../services/trustworthiness.service';
import DesignAuditScreen from './DesignAuditScreen';
import HomeScreen from './HomeScreen';
import TargetSetup from './TargetSetup';
import KnowledgeSources from './KnowledgeSources';
import BenchmarkEditor from './BenchmarkEditor';
import { ArrowLeft, ArrowRight, Check, Code2, House, ScanSearch } from 'lucide-react';
import { Button as UiButton } from '../../ui/button';
import { TooltipProvider } from '../../ui/tooltip';
import { getStepStatus, nextStep } from './evaluationSteps';
import LiveRunScreen from './LiveRunScreen';
import CalibrationScreen from './CalibrationScreen';
import { buttonClass } from './evaluationTheme';

const tabIcons = { home: House, review: ScanSearch, audit: Code2 };

const tabs = [
  ['home', 'Home'],
  ['connect', '1 Connect chatbot'],
  ['documents', '2 Business documents'],
  ['questions', '3 Test questions'],
  ['run', '4 Run and report'],
  ['review', 'Check the grading AI'],
  ['audit', 'Code review'],
];
const legacyViews = { setup: 'connect', calibration: 'review', targets: 'connect', profiles: 'questions', runs: 'run' };
const stepViews = {
  connect: { number: 1, title: 'Connect your chatbot', description: 'Tell CovAI how to start or reach your chatbot.', previous: 'home', next: 'documents', Screen: TargetSetup },
  documents: { number: 2, title: 'Add business documents', description: 'Add the policies and facts your chatbot should know. Test questions are written from these.', previous: 'connect', next: 'questions', Screen: KnowledgeSources },
  questions: { number: 3, title: 'Review test questions', description: 'AI writes test questions from your documents. Check them, then approve.', previous: 'documents', next: 'run', Screen: BenchmarkEditor },
};

export default function TrustworthinessWorkspace({ projectId }) {
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const { userId } = useAuth();
  const params = new URLSearchParams(location.search);
  const requestedView = legacyViews[params.get('view')] || params.get('view');
  const view = tabs.some(([key]) => key === requestedView) ? requestedView : 'home';
  const capabilities = useTrustworthinessQuery(projectId, '/capabilities');
  const workspace = useTrustworthinessQuery(projectId, '', {
    enabled: capabilities.data?.enabled === true,
    poll: true,
  });
  const { refetch: refetchWorkspace } = workspace;
  const workspaceEnabled = capabilities.data?.enabled === true;
  useEffect(() => {
    if (view === 'connect' && workspaceEnabled) refetchWorkspace();
  }, [view, workspaceEnabled, refetchWorkspace]);
  const { connected, progressByRun, prepareByVersion } = useEvaluationSocket({
    projectId: capabilities.data?.enabled ? projectId : null,
    userId,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const workspaceRef = useRef(null);
  useEffect(() => {
    let ancestor = workspaceRef.current?.parentElement;
    while (ancestor) {
      if (['auto', 'scroll'].includes(getComputedStyle(ancestor).overflowY)
        && ancestor.scrollHeight > ancestor.clientHeight) {
        ancestor.scrollTop = 0;
        return;
      }
      ancestor = ancestor.parentElement;
    }
    window.scrollTo(0, 0);
  }, [view]);
  function navigateView(next, extras = {}) {
    const query = new URLSearchParams(location.search);
    query.set('tab', 'trustworthiness');
    query.set('view', legacyViews[next] || next);
    for (const [key, value] of Object.entries(extras)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    navigate(`${location.pathname}?${query}`);
  }
  async function act(action, success = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      await cache.invalidateQueries({ queryKey: evaluationKey(userId, projectId) });
      setNotice(success);
      return result;
    } catch (failure) {
      setError(failure.message || 'Could not complete the evaluation request.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  const api = (suffix, method = 'GET', body) => evaluationRequest(projectId, suffix, { method, body });
  if (!projectId) {
    return <p className="p-5 text-[var(--color-text-secondary)]">Select a project to evaluate its chatbot.</p>;
  }
  if (capabilities.isPending) {
    return (
      <div role="status" aria-label="Loading evaluation configuration" className="space-y-4 p-5">
        <Skeleton rounded="rounded-md" className="h-8 w-64" />
        <Skeleton rounded="rounded-lg" className="h-40 w-full" />
      </div>
    );
  }
  if (capabilities.error) {
    return (
      <div role="alert" className="space-y-3 p-5 text-rose-400">
        <p>{capabilities.error.status === 403
          ? 'Only the project owner can evaluate the chatbot.' : capabilities.error.message}</p>
        <Button className={buttonClass} variant="secondary" onClick={() => capabilities.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!capabilities.data?.enabled) {
    return (
      <div className="space-y-3 p-5">
        <h1 className="text-xl font-semibold">Chatbot evaluation</h1>
        <p>
          This feature is not enabled on the server. Ask an administrator to run the migration and enable
          AI_EVALUATION_ENABLED.
        </p>
      </div>
    );
  }
  const data = workspace.data;
  const common = { projectId, data, api, act, busy, navigateView };
  const status = getStepStatus(data);
  const next = nextStep(status);
  const step = stepViews[view];
  const StepScreen = step?.Screen;
  return (
    <TooltipProvider delayDuration={200}>
    <section ref={workspaceRef} aria-label="Project chatbot evaluation"
      className="mx-auto w-full max-w-[1400px] space-y-6 bg-[var(--color-bg)] px-4 py-5 text-[var(--color-text)] sm:px-8 sm:py-7">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Chatbot evaluation</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Test how well your chatbot answers questions about your business.</p>
          </div>
        </div>
        {!connected && (
          <span role="status" className="inline-flex items-center gap-2 text-xs font-medium text-amber-400">
            <span aria-hidden="true" className="size-2 rounded-full bg-amber-400" />Reconnecting…
          </span>
        )}
      </header>
      <nav role="tablist" aria-label="Evaluation workflow"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-[var(--color-border)] px-1"
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.findIndex(([key]) => key === view);
          let nextIndex;
          if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = tabs.length - 1;
          else nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          event.currentTarget.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
          navigateView(tabs[nextIndex][0]);
        }}>
        {tabs.map(([key, label]) => {
          const active = view === key;
          const step = status[key];
          const TabIcon = tabIcons[key];
          return (
            <button key={key} type="button" id={`evaluation-tab-${key}`} role="tab" aria-selected={active}
              aria-controls={`evaluation-panel-${key}`} tabIndex={active ? 0 : -1}
              className={`relative -mb-px inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:bg-[var(--color-surface-secondary)] ${key === 'review' ? 'ml-auto' : ''} ${active
                ? 'border-[var(--color-primary)] text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              onClick={() => navigateView(key)}>
              {step ? (
                <span className={`flex size-5 items-center justify-center rounded-md text-[11px] font-mono tabular-nums ${step.done
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : active || next === key
                    ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                    : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]'}`}>
                  {step.done ? <Check className="size-3" aria-label="Done" /> : label[0]}
                </span>
              ) : TabIcon && <TabIcon className="size-4" aria-hidden="true" />}
              <span>{step ? label.slice(2) : label}</span>
            </button>
          );
        })}
      </nav>
      {error && <p role="alert" className="rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{notice}</p>}
      {workspace.isPending && (
        <div role="status" aria-label="Loading evaluation workspace">
          <Skeleton rounded="rounded-lg" className="h-48 w-full" />
        </div>
      )}
      {workspace.error && (
        <div role="alert" className="space-y-3 rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-400">
          <p>{workspace.error.message}</p>
          <Button className={buttonClass} variant="secondary" onClick={() => workspace.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {data && (
        <div id={`evaluation-panel-${view}`} role="tabpanel" aria-labelledby={`evaluation-tab-${view}`}>
          {view === 'audit' && <DesignAuditScreen key={projectId} {...common} workspace={data} />}
          {view === 'home' && <HomeScreen {...common} capabilities={capabilities.data} />}
          {step && (
            <div className="space-y-6">
              <header className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Step <span className="font-mono tabular-nums">{step.number}</span> of <span className="font-mono tabular-nums">4</span></p>
                <h2 className="text-xl font-semibold tracking-tight">{step.title}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">{step.description}</p>
              </header>
              <StepScreen key={`${projectId}-${view}`} {...common} capabilities={capabilities.data}
                selectedVersion={params.get('profileVersionId')} external={params.get('mode') === 'external'}
                prepareByVersion={prepareByVersion} actionEnabled={capabilities.data.actionEnabled} />
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
                <UiButton variant="ghost" onClick={() => navigateView(step.previous)}><ArrowLeft aria-hidden="true" />Back</UiButton>
                <div className="flex flex-wrap items-center gap-3">
                  {!status[view].done && <p className="text-sm text-[var(--color-text-muted)]">You can come back to this later.</p>}
                  <UiButton onClick={() => navigateView(step.next)}>Continue<ArrowRight aria-hidden="true" /></UiButton>
                </div>
              </footer>
            </div>
          )}
          {view === 'run' && (
            <LiveRunScreen key={projectId} {...common} runId={params.get('runId')}
              progressByRun={progressByRun} />
          )}
          {view === 'review' && <CalibrationScreen key={projectId} {...common} />}
        </div>
      )}
    </section>
    </TooltipProvider>
  );
}
