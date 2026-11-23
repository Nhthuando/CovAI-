/**
 * Set COVAI_E2E_EMAIL and COVAI_E2E_PASSWORD in the environment.
 * node server/scripts/e2e-system-flow.mjs --base http://localhost:5000 --list
 * node server/scripts/e2e-system-flow.mjs --base http://localhost:5000 --project <id|name>
 * Repeat --project to run multiple projects. Optional flags are --framework
 * auto|playwright|cypress, --skip-generate, --force-generate, and --timeout-min 20.
 * Repeat --env KEY=VALUE for missing startup variables, or use
 * --default-test-env to fill missing variables without an explicit value.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const executionMode = 'full';
const terminalStatuses = new Set(['SUCCESS', 'COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED']);
const password = process.env.COVAI_E2E_PASSWORD;
const secrets = new Set(password ? [password] : []);

function redact(value) {
  let message = String(value);
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
  return message;
}

function singleLine(value) {
  return redact(value).replace(/[\r\n]+/g, ' ');
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: 'http://localhost:5000' },
      project: { type: 'string', multiple: true, default: [] },
      env: { type: 'string', multiple: true, default: [] },
      'default-test-env': { type: 'boolean' },
      framework: { type: 'string', default: 'auto' },
      list: { type: 'boolean' },
      'skip-generate': { type: 'boolean' },
      'force-generate': { type: 'boolean' },
      'timeout-min': { type: 'string', default: '20' },
    },
  });
  const env = new Map();
  for (const entry of values.env) {
    const separator = entry.indexOf('=');
    const name = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (separator < 1 || !/^[A-Za-z_]\w{0,127}$/.test(name) ||
        !value.trim() || value.length > 8192 || value.includes('\0')) {
      throw new Error('--env requires KEY=VALUE with a valid name and a nonblank test value.');
    }
    env.set(name, value);
    secrets.add(value);
  }
  const base = new URL(values.base);
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' ||
      base.username || base.password || base.search || base.hash) {
    throw new Error('--base must be an HTTP(S) origin, such as http://localhost:5000.');
  }
  if (!['auto', 'playwright', 'cypress'].includes(values.framework)) {
    throw new Error('--framework must be auto, playwright, or cypress.');
  }
  if (!values.list && !values.project.length) {
    throw new Error('Specify --list or at least one --project <id|name>.');
  }
  const timeoutMs = Math.round(Number(values['timeout-min']) * 60_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error('--timeout-min must be a positive duration supported by Node timers.');
  }
  return { ...values, base, env, timeoutMs };
}

class HttpError extends Error {
  constructor(method, url, response, body) {
    const details = [body?.code, body?.message || body?.error?.message || response.statusText]
      .filter(Boolean).join(' ');
    super(`${method} ${url.pathname}${url.search} ${response.status} ${details}`.trim());
    this.status = response.status;
  }
}

function createApi(base, timeoutMs) {
  let token;
  let refreshCookie;

  async function send(method, path, { body, session, signal }) {
    const url = new URL(`/api${path}`, base);
    const headers = { Accept: 'application/json' };
    if (session === 'refresh' && refreshCookie) headers.Cookie = refreshCookie;
    if (!session && token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method, headers, signal, redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (session) {
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0];
        if (pair.startsWith('refreshToken=')) refreshCookie = pair;
      }
    }
    const raw = await response.text();
    let payload;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        if (response.ok) {
          throw new Error(`${method} ${url.pathname} returned invalid JSON.`, { cause: error });
        }
        payload = null;
      }
    }
    if (!response.ok) {
      const error = new HttpError(method, url, response, payload);
      console.error(redact(error.message));
      throw error;
    }
    return payload;
  }

  async function request(method, path, { body, signal = AbortSignal.timeout(timeoutMs) } = {}) {
    try {
      return await send(method, path, { body, signal });
    } catch (error) {
      if (error.status !== 401) throw error;
      const refreshed = await send('POST', '/refresh', { session: 'refresh', signal });
      token = refreshed?.accessToken;
      if (!token) throw new Error('Refresh response did not include an access token.');
      return send(method, path, { body, signal });
    }
  }

  return {
    get: (path, signal) => request('GET', path, { signal }),
    post: (path, body) => request('POST', path, { body }),
    async login(email) {
      const login = await send('POST', '/auth/login', {
        body: { email, password }, session: 'login', signal: AbortSignal.timeout(timeoutMs),
      });
      token = login?.accessToken || login?.token;
      if (!token) throw new Error('Login response did not include an access token.');
    },
  };
}

function selectProject(projects, selector) {
  const byId = projects.find(project => String(project.id) === selector);
  if (byId) return byId;
  const matches = projects.filter(project => project.name === selector);
  if (matches.length > 1) throw new Error(`Multiple projects match "${selector}". Use the project ID.`);
  if (!matches.length) throw new Error(`No project matches "${selector}".`);
  return matches[0];
}

async function latestSnapshotId(api, project) {
  const embeddedId = project.latestSnapshotId || project.snapshots?.[0]?.id || project.snapshotId;
  if (embeddedId) return embeddedId;
  const response = await api.get(`/projects/${encodeURIComponent(project.id)}/snapshots`);
  return response?.data?.[0]?.id;
}

async function detectFrameworks(api, project, snapshotId, timeoutMs) {
  const query = new URLSearchParams({ snapshotId });
  const path = `/projects/${encodeURIComponent(project.id)}/system-test/frameworks?${query}`;
  const signal = AbortSignal.timeout(timeoutMs);
  for (;;) {
    try {
      const response = await api.get(path, signal);
      if (!response?.data) throw new Error('Framework discovery returned no data.');
      return response.data;
    } catch (error) {
      if (error.status !== 409 || !/not ready/i.test(error.message)) throw error;
      await delay(3_000, undefined, { signal });
    }
  }
}

function matchesFramework(entry, framework) {
  return String(entry?.name || '').toLowerCase().includes(framework);
}

function countFrameworkSpecs(frameworks, framework) {
  return frameworks.filter(entry => matchesFramework(entry, framework))
    .reduce((sum, entry) => sum + (Number(entry.testFileCount) || 0), 0);
}

function pickDefaultSystemFramework(frameworks) {
  const playwright = countFrameworkSpecs(frameworks, 'playwright');
  const cypress = countFrameworkSpecs(frameworks, 'cypress');
  if (playwright > 0) return 'playwright';
  if (cypress > 0) return 'cypress';
  const hasCypress = frameworks.some(entry => matchesFramework(entry, 'cypress'));
  const hasPlaywright = frameworks.some(entry => matchesFramework(entry, 'playwright'));
  return hasCypress && !hasPlaywright ? 'cypress' : 'playwright';
}

async function listProjects(api, projects, timeoutMs) {
  let failed = false;
  console.log('ID | Project | Latest snapshot | Frameworks (testFileCount)');
  for (const project of projects) {
    let snapshotId;
    let frameworks = '-';
    try {
      snapshotId = await latestSnapshotId(api, project);
      if (snapshotId) {
        const discovery = await detectFrameworks(api, project, snapshotId, timeoutMs);
        frameworks = (discovery.frameworks || [])
          .map(entry => `${entry.name} (${entry.testFileCount ?? 0})`).join(', ') || 'none';
      }
    } catch (error) {
      failed = true;
      frameworks = 'unavailable';
      console.error(redact(`${project.name}: ${error.message}`));
    }
    console.log(singleLine(`${project.id} | ${project.name} | ${snapshotId || '-'} | ${frameworks}`));
  }
  return failed ? 1 : 0;
}

async function generateAndApply(api, systemPath, framework, projectName) {
  const { data: draft } = await api.post(`${systemPath}/generate-tests`, {
    framework, routes: ['/'], executionMode,
  });
  if (!draft?.aiTestId || !draft.candidateHash) {
    throw new Error('Generation response did not include a draft ID and candidate hash.');
  }
  const count = draft.scenarioCount ?? draft.scenariosCount ?? draft.scenarios?.length ?? 0;
  console.log(singleLine(`${projectName} | Draft ${draft.filePath} | ${count} scenarios`));
  await api.post(`${systemPath}/generation-drafts/${encodeURIComponent(draft.aiTestId)}/apply`, {
    reviewed: true, approveSharedSetup: true, expectedCandidateHash: draft.candidateHash,
  });
}

async function pollJob(api, projectId, jobId, timeoutMs) {
  const jobsPath = `/job/${encodeURIComponent(projectId)}/jobs`;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    for (;;) {
      const { jobs } = await api.get(jobsPath, signal);
      const job = jobs.find(entry => entry.id === jobId);
      if (terminalStatuses.has(job?.status)) return job;
      await delay(5_000, undefined, { signal });
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`Timed out waiting for job ${jobId}.`, { cause: error });
    throw error;
  }
}

async function loadResults(api, systemPath, framework, assessmentId, row) {
  const query = new URLSearchParams({ executionMode, runner: framework });
  const { data: summary } = await api.get(`${systemPath}/summary?${query}`);
  const assessment = assessmentId
    ? (await api.get(`${systemPath}/assessments/${encodeURIComponent(assessmentId)}`)).data
    : null;
  const execution = assessment?.presentation?.execution;
  if (execution || summary?.hasRun) {
    row.passed = execution?.passed ?? summary?.passedTests ?? 0;
    row.failed = execution?.failed ?? summary?.failedTests ?? 0;
    row.total = execution?.selected ?? summary?.totalTests ?? 0;
  }
  if (summary?.hasRun && summary.testRunId) {
    query.set('testRunId', summary.testRunId);
    const { data } = await api.get(`${systemPath}/scenarios?${query}`);
    for (const file of data?.testFiles || []) {
      for (const scenario of file.scenarios || []) {
        if (String(scenario.status).toUpperCase() !== 'FAILED') continue;
        const error = scenario.errorMessage || scenario.breakpoint?.errorMessage || scenario.executionDetails?.attempts?.flatMap((a) => a.errors || [])?.[0] || 'No error message returned.';
        console.error(singleLine(`${row.project} | ${file.filePath} | ${scenario.title}: ${redact(error).slice(0, 300)}`));
      }
    }
  }
}

async function runProject(api, projects, selector, options, row) {
  const project = selectProject(projects, selector);
  row.project = `${project.name} (${project.id})`;
  const snapshotId = await latestSnapshotId(api, project);
  if (!snapshotId) throw new Error('No latest snapshot is available.');
  const projectPath = `/projects/${encodeURIComponent(project.id)}`;
  const systemPath = `/coverage/${encodeURIComponent(snapshotId)}/system`;
  let discovery = await detectFrameworks(api, project, snapshotId, options.timeoutMs);
  const frameworks = discovery.frameworks || [];
  const framework = options.framework === 'auto' ? pickDefaultSystemFramework(frameworks) : options.framework;
  row.framework = framework;

  const accessResponse = await api.get(`${projectPath}/access`);
  const access = accessResponse?.data ?? accessResponse;
  if (!access?.capabilities?.includes('tests.run')) throw new Error('Project access does not grant tests.run.');
  if (!options['skip-generate'] && (options['force-generate'] || countFrameworkSpecs(frameworks, framework) === 0)) {
    await generateAndApply(api, systemPath, framework, row.project);
    discovery = await detectFrameworks(api, project, snapshotId, options.timeoutMs);
  }

  let { data: setup } = await api.get(`${systemPath}/setup`);
  const missing = setup?.environment?.filter(row => row.status === 'MISSING') ?? [];
  if (missing.length) {
    const names = [...new Set(missing.map(row => row.name))];
    const unspecified = names.filter(name => !options.env.has(name));
    if (unspecified.length && !options['default-test-env']) {
      const flags = unspecified.map(name => `--env ${name}=test-value`).join(' ');
      throw new Error(`Missing startup test values for ${names.join(', ')}. Supply ${flags}.`);
    }
    const variables = missing.map(({ envFile, name }) => {
      const value = options.env.get(name) ?? `covai-test-${name.toLowerCase()}`;
      secrets.add(value);
      return { envFile, name, value };
    });
    await api.post(`${systemPath}/setup/environment`, {
      expectedWorkspaceRevision: setup.workspaceRevision,
      variables,
    });
    ({ data: setup } = await api.get(`${systemPath}/setup`));
    const stillMissing = setup?.environment?.filter(row => row.status === 'MISSING') ?? [];
    if (stillMissing.length) {
      const names = [...new Set(stillMissing.map(row => row.name))];
      throw new Error(`Startup test values are still missing for ${names.join(', ')}.`);
    }
  }
  if (!setup?.ready) {
    throw new Error(setup?.issues?.map(issue => issue.message || issue.code).join(' ') || 'Project setup is not ready.');
  }
  const capabilities = framework === 'playwright'
    ? (await api.get(`${systemPath}/capabilities`)).data : null;
  const assessment = capabilities?.enabled && capabilities.coverageEnabled;
  row.path = assessment ? 'assessment' : 'analysis';
  const count = Number.isInteger(discovery.totalFilesCount) ? discovery.totalFilesCount : discovery.allTestFiles?.length;
  if (!assessment && !discovery.error && count === 0 && !discovery.errors?.length) {
    throw new Error('Automatic test generation is turned off on this server. Generate tests and apply them first.');
  }
  const { data: run } = assessment
    ? await api.post(`${systemPath}/assessments`, {
      autoDiscover: true, runner: 'playwright', executionMode,
      allowGenerate: access.capabilities.includes('ai.use'), headed: false,
    })
    : await api.post(`${systemPath}/run`, { framework, executionMode, testFile: null });

  if (!run?.jobId) throw new Error('Server did not return a system test job ID.');
  console.log(singleLine(`${row.project} | ${framework} | ${row.path} | Job ${run.jobId}`));
  row.status = 'POLLING';
  const job = await pollJob(api, project.id, run.jobId, options.timeoutMs);
  row.status = job.status;
  if (job.status !== 'SUCCESS') {
    console.error(singleLine(`${row.project} | Job ${job.id} ${job.status}: ${job.errorMessage || job.message || 'No job error details.'}`));
  }
  await loadResults(api, systemPath, framework, job.status === 'SUCCESS' ? run.assessmentId : null, row);
  return job.status === 'SUCCESS';
}

async function main() {
  const options = readOptions();
  const email = process.env.COVAI_E2E_EMAIL;
  if (!email || !password) throw new Error('Set COVAI_E2E_EMAIL and COVAI_E2E_PASSWORD.');
  const api = createApi(options.base, options.timeoutMs);
  await api.login(email);
  const { projects } = await api.get('/projects');
  if (!Array.isArray(projects)) throw new Error('Project list response did not include projects.');
  if (options.list) return listProjects(api, projects, options.timeoutMs);

  const rows = [];
  let failed = false;
  for (const selector of options.project) {
    const row = { project: selector, framework: '-', path: '-', status: 'ERROR', passed: '-', failed: '-', total: '-' };
    rows.push(row);
    try {
      if (!await runProject(api, projects, selector, options, row)) failed = true;
    } catch (error) {
      failed = true;
      if (row.status === 'POLLING') row.status = error.cause && /Timed out/.test(error.message) ? 'TIMEOUT' : 'ERROR';
      console.error(redact(`${row.project}: ${error.message}`));
    }
  }
  console.log('\nProject | Framework | Path | Job status | Passed/Failed/Total');
  for (const row of rows) {
    console.log(singleLine(`${row.project} | ${row.framework} | ${row.path} | ${row.status} | ${row.passed}/${row.failed}/${row.total}`));
  }
  return failed ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error.code?.startsWith('ERR_PARSE_ARGS_')) {
    console.error('Invalid command-line arguments. Use --env KEY=VALUE for startup test values.');
  } else if (!(error instanceof HttpError)) {
    console.error(redact(error.message));
  }
  process.exitCode = 1;
}
