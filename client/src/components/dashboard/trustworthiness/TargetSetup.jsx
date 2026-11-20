import { useState } from 'react';
import { CircleCheck, CircleX, FolderGit2, Globe, Settings2, Zap } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Panel, Field, JsonEditor, SecretInput, CopyCommand } from './ui';
import { buttonClass, inputClass, interactive } from './evaluationTheme';

const keyHint =
  "Your chatbot needs this to answer. It's used only during the test and never saved.";

function probeErrorText(failure) {
  const message = typeof failure?.message === 'string' ? failure.message.trim() : '';
  if (message && (['TARGET_HTTP_ERROR', 'TARGET_RATE_LIMIT'].includes(failure?.code) || message.startsWith('Your chatbot returned HTTP'))) return message;
  return message || 'Check the chatbot URL and test credentials.';
}

function detectedPatch(auto) {
  return {
    ...(auto?.endpointPath ? { endpointPath: auto.endpointPath } : {}),
    ...(auto?.llmEnvVars?.length ? { llmEnvVars: auto.llmEnvVars } : {}),
    ...(auto?.bindings && Object.keys(auto.bindings).length ? { bindings: auto.bindings } : {}),
    ...(auto?.conversationMode ? { conversationMode: auto.conversationMode } : {}),
    ...(auto?.responsePointer ? { response: {
      format: auto.responseFormat || 'json',
      answer: auto.responsePointer,
      ...(auto.responseConversationIdPointer ? { conversationId: auto.responseConversationIdPointer } : {}),
    } } : {}),
  };
}

function differsFromDetected(config, auto) {
  if (!auto || config?.executionMode !== 'MANAGED_PROJECT') return false;
  const patch = detectedPatch(auto);
  return (patch.endpointPath !== undefined && config.endpointPath !== patch.endpointPath)
    || (patch.bindings !== undefined && JSON.stringify(config.bindings) !== JSON.stringify(patch.bindings))
    || (patch.llmEnvVars !== undefined && JSON.stringify([...(config.llmEnvVars || [])].sort()) !== JSON.stringify([...patch.llmEnvVars].sort()))
    || (patch.response !== undefined && config.response?.answer !== patch.response.answer);
}

function initialConfig(audit, external) {
  const auto = audit?.autoFillConfig || {};
  return {
    executionMode: external ? 'EXTERNAL_URL' : 'MANAGED_PROJECT',
    endpointPath: auto.endpointPath || '/api/chat',
    llmEnvVars: auto.llmEnvVars || [],
    environment: {},
    auth: { type: auto.requiresRouteAuth ? 'bearer' : 'none', header: 'X-API-Key' },
    requestTemplate: auto.requestTemplate || {},
    bindings: auto.bindings || {
      '/messages': 'messages',
      '/conversationId': 'conversationId',
      '/requestId': 'requestId',
      '/evaluationContext': 'evaluationContext',
    },
    response: { format: auto.responseFormat || 'json', answer: auto.responsePointer || '/answer', ...(auto.responseConversationIdPointer ? { conversationId: auto.responseConversationIdPointer } : {}) },
    conversationMode: auto.conversationMode || 'messages',
    mockGateway: false,
    testEnvironmentConfirmed: false,
    targetVersion: 'v1',
  };
}

export default function TargetSetup({ data, api, act, busy, external, navigateView }) {
  const target = data.targets.find(item => !item.archivedAt && item.versions?.[0]);
  const version = target?.versions[0];
  const auto = data.designAudit?.autoFillConfig;
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);
  const [savedBeforeScan, setSavedBeforeScan] = useState(null);
  const [scanAppliedFor, setScanAppliedFor] = useState('');
  const [missingFields, setMissingFields] = useState([]);
  const scanId = data.designAudit?.updatedAt || data.designAudit?.id || '';
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [configState, setConfigState] = useState(() => ({
    external,
    value: initialConfig(data.designAudit, external),
  }));
  // Derive the URL-driven mode without an effect resetting component state.
  const config = external && configState.external !== external
    ? { ...configState.value, executionMode: 'EXTERNAL_URL' }
    : configState.value;
  if (configState.external !== external) {
    setConfigState({ external, value: config });
  }
  const setConfig = next => setConfigState(previous => {
    const current = external && previous.external !== external
      ? { ...previous.value, executionMode: 'EXTERNAL_URL' }
      : previous.value;
    return { external, value: typeof next === 'function' ? next(current) : next };
  });
  const [llmApiKey, setLlmApiKey] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [environmentText, setEnvironmentText] = useState('');
  const [probe, setProbe] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  if (!edit && auto && scanId && scanId !== scanAppliedFor) {
    setScanAppliedFor(scanId);
    setConfig({
      ...config,
      ...detectedPatch(auto),
      requestTemplate: { ...(auto.requestTemplate || {}), ...(config.requestTemplate || {}) },
    });
    setEditorKey(previous => previous + 1);
  }
  // Secrets belong only to this mounted component; no storage or cached mutations.
  const managed = config.executionMode === 'MANAGED_PROJECT';
  const required = managed ? (auto?.requiredBodyFields || []) : [];
  const begin = target => {
    const current = target.versions[0];
    if (!current) return;
    const { endpoint: savedEndpoint, ...rest } = current.config;
    setEditing(true);
    setEdit(target.id);
    setName(target.name);
    setEndpoint(savedEndpoint || '');
    const applyScan = differsFromDetected(rest, auto);
    setSavedBeforeScan(applyScan ? rest : null);
    setConfig(applyScan ? {
      ...rest,
      ...detectedPatch(auto),
      requestTemplate: { ...(auto.requestTemplate || {}), ...(rest.requestTemplate || {}) },
    } : rest);
    setMissingFields([]);
    setEnvironmentText(Object.entries(rest.environment || {}).map(([key, value]) => `${key}=${value}`).join('\n'));
    setLlmApiKey('');
    setAuthToken('');
    setEditorKey(previous => previous + 1);
  };
  const changeMode = executionMode => {
    setConfig(previous => ({ ...previous, executionMode }));
    setLlmApiKey('');
    setAuthToken('');
    setProbe(null);
    setEditorKey(previous => previous + 1);
    navigateView('setup', { mode: executionMode === 'EXTERNAL_URL' ? 'external' : null });
  };
  const test = targetId => act(async () => {
    try {
      const result = await api(`/targets/${targetId}/test-connection`, 'POST', {
        ...(llmApiKey ? { llmApiKey } : {}),
        ...(authToken ? { credential: authToken } : {}),
      });
      setProbe({ targetId, result });
      return result;
    } catch (failure) {
      setProbe({ targetId, error: probeErrorText(failure) });
      throw failure;
    } finally {
      setLlmApiKey('');
      setAuthToken('');
    }
  });
  return (
    <Panel>
      {version && !editing ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold tracking-tight">{target.name}</h3>
                <Badge variant="outline" className="font-mono tabular-nums">v{version.version}</Badge>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
                {version.config.executionMode === 'EXTERNAL_URL'
                  ? <><Globe className="size-3.5" aria-hidden="true" />Online chatbot at a URL</>
                  : <><FolderGit2 className="size-3.5" aria-hidden="true" />Started from your project for each test</>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => begin(target)}><Settings2 aria-hidden="true" />Edit</Button>
              <Button loading={busy} onClick={() => test(target.id)}><Zap aria-hidden="true" />Test connection</Button>
            </div>
          </div>
          <dl className="grid overflow-hidden rounded-md border border-[var(--color-border)] text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="px-4 pt-3 text-[var(--color-text-muted)] sm:py-3">{version.config.executionMode === 'EXTERNAL_URL' ? 'URL' : 'Chat route'}</dt>
            <dd className="break-all px-4 pb-3 font-mono tabular-nums sm:py-3">{version.config.endpoint || version.config.endpointPath}</dd>
            {version.config.executionMode !== 'EXTERNAL_URL' && !!version.config.llmEnvVars?.length && <>
              <dt className="border-t border-[var(--color-border)] px-4 pt-3 text-[var(--color-text-muted)] sm:py-3">Needs</dt>
              <dd className="flex flex-wrap gap-1.5 px-4 pb-3 sm:border-t sm:border-[var(--color-border)] sm:py-3">
                {version.config.llmEnvVars.map(key => <Badge key={key} variant="secondary" className="font-mono">{key}</Badge>)}
              </dd>
            </>}
            {version.config.executionMode === 'MANAGED_PROJECT' && !!Object.keys(version.config.environment || {}).length && <>
              <dt className="border-t border-[var(--color-border)] px-4 pt-3 text-[var(--color-text-muted)] sm:py-3">Settings</dt>
              <dd className="flex flex-wrap gap-1.5 px-4 pb-3 sm:border-t sm:border-[var(--color-border)] sm:py-3">
                {Object.entries(version.config.environment).map(([key, value]) => <Badge key={key} variant="secondary" className="font-mono">{key}={value}</Badge>)}
              </dd>
            </>}
            <dt className="border-t border-[var(--color-border)] px-4 pt-3 text-[var(--color-text-muted)] sm:py-3">Reply field</dt>
            <dd className="px-4 pb-3 font-mono tabular-nums sm:border-t sm:border-[var(--color-border)] sm:py-3">{version.config.response?.answer || '/answer'}</dd>
          </dl>
          {differsFromDetected(version.config, auto) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <p>Settings differ from the latest code scan.</p>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => begin(target)}>Update from scan</Button>
            </div>
          )}
          {probe?.targetId === target.id && (
            <p role="status" className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${probe.error ? 'border-rose-500/20 bg-rose-500/10 text-rose-400' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'}`}>
              {probe.error ? <><CircleX className="size-4" aria-hidden="true" />Couldn&apos;t connect: {probe.error}</>
                : <><CircleCheck className="size-4" aria-hidden="true" />Connected{probe.result.latencyMs != null && <> · <span className="font-mono tabular-nums">{probe.result.latencyMs} ms</span></>}</>}
            </p>
          )}
        </div>
      ) : (
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        const missing = required.filter(name => !String(config.requestTemplate?.[name] ?? '').trim());
        setMissingFields(missing);
        if (missing.length) return;
        act(async () => {
          const result = await api(edit ? `/targets/${edit}/versions` : '/targets', 'POST', {
            name,
            config: { ...config, ...(managed ? {} : { endpoint, environment: {} }) },
          });
          setEditing(false);
          setEdit(null);
          setSavedBeforeScan(null);
          setName('');
          setEndpoint('');
          setProbe(null);
          return result;
        }, 'Target version saved.');
      }}>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Choose how to connect</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ['MANAGED_PROJECT', 'Start it from my project', "CovAI starts your project's server for the test and stops it afterwards."],
              ['EXTERNAL_URL', 'Use a running chatbot URL', 'Your chatbot is already online. CovAI sends questions to its URL.'],
            ].map(([mode, label, description]) => (
              <label key={mode} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${interactive} ${config.executionMode === mode ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}>
                <input className="mt-1 accent-[var(--color-primary)]" type="radio" name="connection-mode"
                  value={mode} checked={config.executionMode === mode} onChange={() => changeMode(mode)} />
                <span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{description}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Chatbot name">
          <input className={inputClass} required maxLength={150} value={name}
            onChange={event => setName(event.target.value)} />
        </Field>
        {savedBeforeScan && (
          <div className="space-y-3 rounded-lg border border-[var(--color-primary)]/50 bg-[var(--color-primary)]/5 p-4 text-sm">
            <p>Settings updated from the latest code scan: route {auto.endpointPath}, question field {Object.entries(auto.bindings || {}).find(([, value]) => value === 'latestUserMessage' || value === 'messages')?.[0] || 'messages'}, key {auto.llmEnvVars?.join(', ') || 'none'}. Review, then Save.</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => {
              setConfig(savedBeforeScan);
              setSavedBeforeScan(null);
              setEditorKey(previous => previous + 1);
            }}>Keep my saved settings</Button>
          </div>
        )}
        {managed ? (
          <>
            <SecretInput label={`${config.llmEnvVars?.[0] || 'API key'} value`} value={llmApiKey} onChange={setLlmApiKey} hint={keyHint} />
            {required.map(name => (
              <Field key={name} label={`${name} (required by your chatbot)`}
                hint={name === 'model' ? 'The model name your chatbot sends to its AI provider, e.g. the model your API key can use.' : undefined}>
                <input className={inputClass} type="text" value={config.requestTemplate?.[name] ?? ''} onChange={event => {
                  const value = event.target.value;
                  setConfig(previous => ({ ...previous, requestTemplate: { ...previous.requestTemplate, [name]: value } }));
                  setMissingFields([]);
                  setEditorKey(previous => previous + 1);
                }} />
              </Field>
            ))}
            <Field label="Extra settings (optional)" hint="One NAME=value per line, passed to your chatbot when CovAI starts it. Example: GEMINI_MODEL=gemini-3.1-flash-lite. Do not put keys here.">
              <textarea className={inputClass} rows={3} value={environmentText} onChange={event => {
                const text = event.target.value;
                setEnvironmentText(text);
                const entries = text.split(/\r?\n/).filter(line => line.trim()).map(line => {
                  const separator = line.indexOf('=');
                  return separator < 0 ? [line.trim(), ''] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
                });
                setConfig(previous => ({ ...previous, environment: Object.fromEntries(entries) }));
                setEditorKey(previous => previous + 1);
              }} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Chatbot URL">
              <input className={inputClass} required type="url" pattern="https://.*" value={endpoint}
                onChange={event => setEndpoint(event.target.value)}
                placeholder="https://chatbot.example.com/chat" />
            </Field>
          </>
        )}
        <details>
          <summary className={`cursor-pointer rounded-md ${interactive}`}>Advanced</summary>
          <div className="mt-3 space-y-3">
            {managed && <div aria-label="Detected configuration" className="flex flex-wrap gap-2">
              {[config.endpointPath, ...(config.llmEnvVars || [])].filter(Boolean).map(value => (
                <code key={value} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2 py-1 text-xs font-mono tabular-nums">{value}</code>
              ))}
            </div>}
            {!managed && <details>
              <summary className={`cursor-pointer rounded-md ${interactive}`}>
                Running the chatbot on your own machine?
              </summary>
              <div className="mt-3 space-y-2">
                <CopyCommand command="cloudflared tunnel --url http://localhost:8000" />
                <CopyCommand command="ngrok http 8000" />
                <p className="text-sm">VS Code: Ports → Forward a Port → Visibility: Public</p>
              </div>
            </details>}
        {(!managed || data.designAudit?.autoFillConfig?.requiresRouteAuth || config.auth.type !== 'none') && (
          <SecretInput label={managed ? 'Route auth token (Bearer / API key)' : 'Auth token (optional)'}
            value={authToken} onChange={setAuthToken}
            hint="Optional. Used for the connection test and cleared afterward." />
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Authentication">
            <select className={inputClass} value={config.auth.type} onChange={event => {
              setConfig({ ...config, auth: { ...config.auth, type: event.target.value } });
              setEditorKey(previous => previous + 1);
            }}>
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="apiKey">API key header</option>
            </select>
          </Field>
          <Field label="Where the answer is in the reply" hint="JSON pointer, for example /answer">
            <input className={inputClass} required value={config.response.answer} onChange={event => {
              setConfig({ ...config, response: { ...config.response, answer: event.target.value } });
              setEditorKey(previous => previous + 1);
            }} />
          </Field>
        </div>
            <JsonEditor key={editorKey} label="Adapter JSON configuration" value={config} onChange={value => {
              if (!value.auth?.type || !value.response?.answer || !value.bindings ||
                !['MANAGED_PROJECT', 'EXTERNAL_URL'].includes(value.executionMode)) {
                throw new Error('Missing adapter fields');
              }
              setConfig(value);
              setEnvironmentText(Object.entries(value.environment || {}).map(([key, setting]) => `${key}=${setting}`).join('\n'));
            }} />
            <p className="text-sm text-[var(--color-text-muted)]">
              Action tools require mockGateway and testEnvironmentConfirmed. Connect a test environment
              with production access disabled.
            </p>
          </div>
        </details>
        {!!missingFields.length && <p role="alert" className="text-sm text-rose-400">Fill in: {missingFields.join(', ')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button className={buttonClass} type="submit" variant="primary" loading={busy}>Save</Button>
          {version && (
            <Button className={buttonClass} variant="secondary" disabled={busy} onClick={() => {
              setEditing(false);
              setEdit(null);
              setSavedBeforeScan(null);
              setMissingFields([]);
              setName('');
              setEndpoint('');
              setConfig(initialConfig(data.designAudit, external));
              setEnvironmentText('');
              setLlmApiKey('');
              setAuthToken('');
              setEditorKey(previous => previous + 1);
            }}>
              Cancel
            </Button>
          )}
        </div>
      </form>
      )}
    </Panel>
  );
}
