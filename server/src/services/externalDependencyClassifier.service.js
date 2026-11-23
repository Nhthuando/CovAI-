import fs from 'node:fs';
import { EXTERNAL_SERVICES, serviceForHost } from './externalServiceCatalog.service.js';
import { humanizeVendorToken, vendorTokenForEnvName, vendorTokenForHost } from '../utils/vendorToken.js';

export const readEgressLog = logPath => {
  if (!logPath) return [];
  let contents;
  try {
    contents = fs.readFileSync(logPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[externalDependencyClassifier] Could not read the egress log:', error.code);
    return [];
  }
  const events = [];
  let warned = false;
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event?.id === 'string' && Number.isFinite(event.t) &&
          ['start', 'end', 'error'].includes(event.event)) events.push(event);
    } catch (error) {
      if (!warned) console.warn('[externalDependencyClassifier] Skipping malformed egress log lines.');
      warned = true;
    }
  }
  return events;
};

const failureCategory = matches => {
  if (matches.some(({ end }) => end?.status === 401 || end?.status === 403)) return 'AUTH_REJECTED';
  if (matches.some(({ end, error }) => !end && !error)) return 'BACKEND_STOPPED_DURING_EXTERNAL_CALL';
  if (matches.some(({ error }) => error?.code != null)) return 'UNREACHABLE';
  if (matches.some(({ end }) => end?.status >= 500)) return 'PROVIDER_ERROR';
  return 'REQUEST_REJECTED';
};

export const classifyExternalCalls = ({ report, egressEvents, environment = [] }) => {
  const credentialFailures = new Map();
  const callFailures = new Map();
  const calls = new Map();
  for (const event of egressEvents) {
    if (!calls.has(event.id)) calls.set(event.id, {});
    const call = calls.get(event.id);
    if (event.event === 'start') call.start = event;
    if (event.event === 'end') call.end = event;
    if (event.event === 'error') call.error = event;
  }
  const failed = [...calls.values()].filter(({ start, end, error }) =>
    typeof start?.host === 'string' && (error || !end || end.status >= 400));
  if (!failed.length) return { credentialFailures, callFailures };

  const visit = (suite, parentFile) => {
    const suiteFile = suite.file || parentFile;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const result = test.results?.at(-1);
        if (!result || result.status === 'passed') continue;
        const startTime = Date.parse(result.startTime);
        if (!Number.isFinite(startTime) || !Number.isFinite(result.duration)) continue;
        const matches = failed.filter(({ start }) =>
          start.t >= startTime - 500 && start.t <= startTime + result.duration + 2000);
        if (!matches.length) continue;
        const category = failureCategory(matches);
        const isAuthRejected = category === 'AUTH_REJECTED';
        const matchedCalls = new Map();
        for (const { start, end, error } of matches) {
          const call = { host: start.host, status: end?.status ?? null, code: error?.code ?? null };
          matchedCalls.set(JSON.stringify(call), call);
          if (matchedCalls.size === 5) break;
        }
        const hosts = [...new Set(matches.map(({ start }) => start.host))];
        const services = new Map();
        const variables = new Set();
        for (const host of hosts) {
          const service = serviceForHost(host);
          if (!service) {
            const token = vendorTokenForHost(host);
            if (token) {
              const id = `env:${token}`;
              services.set(id, { id, label: humanizeVendorToken(token), host });
              if (isAuthRejected) {
                for (const { name } of environment) {
                  if (vendorTokenForEnvName(name) === token) variables.add(name);
                }
              }
            } else {
              services.set(`host:${host}`, { id: `host:${host}`, label: host });
            }
            continue;
          }
          services.set(service.id, { id: service.id, label: service.label });
          if (!isAuthRejected) continue;
          const rows = environment.filter(row => row.provider?.id === service.id);
          for (const name of rows.length ? rows.map(row => row.name) : [service.primaryEnv]) variables.add(name);
        }
        const evidence = {
          services: [...services.values()],
          hosts,
          calls: [...matchedCalls.values()],
        };
        const failure = isAuthRejected ? {
          ...evidence,
          variables: [...variables],
          configured: environment.length
            ? [...variables].every(name => environment.some(row => row.name === name && row.status === 'PRESENT'))
            : null,
          reason: 'AUTH_REJECTED',
        } : { ...evidence, category };
        const failures = isAuthRejected ? credentialFailures : callFailures;
        if (spec.file) failures.set(`${spec.file}::${spec.title}`, failure);
        if (suiteFile && suiteFile !== spec.file) failures.set(`${suiteFile}::${spec.title}`, failure);
        failures.set(spec.title, failure);
      }
    }
    for (const child of suite.suites || []) visit(child, suiteFile);
  };
  for (const suite of report.suites || []) visit(suite);
  return { credentialFailures, callFailures };
};

export const classifyExternalDependencies = options => classifyExternalCalls(options).credentialFailures;

export const collectExternalRequirements = entries => {
  const requirements = new Map();
  for (const [title, dependency] of entries) {
    for (const { id, label } of dependency.services) {
      if (!requirements.has(id)) requirements.set(id, { id, label, variables: new Set(), scenarios: [] });
      const requirement = requirements.get(id);
      requirement.scenarios.push(title);
      const catalog = EXTERNAL_SERVICES.find(service => service.id === id);
      for (const variable of dependency.variables) {
        if (catalog
          ? variable === catalog.primaryEnv || catalog.envPatterns.some(pattern => pattern.test(variable))
          : id.startsWith('env:') && vendorTokenForEnvName(variable) === id.slice(4)) {
          requirement.variables.add(variable);
        }
      }
    }
  }
  return [...requirements.values()].map(entry => ({ ...entry, variables: [...entry.variables] }));
};
