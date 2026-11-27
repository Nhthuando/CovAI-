export const SYSTEM_PLAN_VERSION = 'system-plan-v1';
export const SYSTEM_PLAN_MAX_ITEMS = 60;

const AUTH_ROUTE = /(^|\/)(login|log-in|signin|sign-in|register|signup|sign-up|logout|auth|account|profile)(\/|$)/;
const FORM_ROUTE = /(^|\/)(new|create|edit|add|login|log-in|signin|sign-in|register|signup|sign-up|search|settings|checkout|contact)(\/|$)/;
const INPUT_ROLE = /^\s*-\s*(textbox|searchbox|combobox|spinbutton)\b/m;
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function humanize(handler) {
  return handler
    .replace(/^(?:handle|on)(?=[A-Z])/, '')
    .replace(/^set(?=(?:Show|Is|Open)(?:[A-Z]|$))/, 'toggle ')
    .replace(/^set(?=[A-Z])/, 'change ')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

export function normalizePlanRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.includes('*')) {
    return null;
  }
  return route.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
}

export function buildSystemTestPlan(input = {}) {
  const { routes, liveSnapshots, validationChecklist, backendEndpoints, components = [], maxItems } = input ?? {};
  const uniqueRoutes = new Set(['/']);
  for (const route of Array.isArray(routes) ? routes : []) {
    const normalized = normalizePlanRoute(route);
    if (normalized) uniqueRoutes.add(normalized);
  }

  const inputsByRoute = new Map();
  for (const entry of Array.isArray(liveSnapshots) ? liveSnapshots : []) {
    const route = normalizePlanRoute(entry?.route);
    if (route) {
      inputsByRoute.set(route, typeof entry.snapshot === 'string' && INPUT_ROLE.test(entry.snapshot));
    }
  }

  const hasMutationApi = Array.isArray(backendEndpoints) && backendEndpoints.some(
    endpoint => typeof endpoint?.method === 'string' && MUTATION_METHODS.has(endpoint.method.toUpperCase()),
  );
  const happy = [];
  const auth = [];
  const error = [];
  const edge = [];
  const dynamic = [];
  const componentHappy = [];
  const componentError = [];
  const componentEdge = [];

  for (const component of Array.isArray(components) ? components : []) {
    const name = component?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const { filePath, controls, handlers, actions, hasForm, mutationApi } = component;
    const labels = Array.isArray(controls) ? controls.slice(0, 3).join(', ') : '';
    const evidence = [filePath, ...(Array.isArray(handlers) ? handlers.map(handler => `handler:${handler}`) : [])];
    const item = (caseKey, title, itemEvidence = evidence) => ({
      id: `ui:${name}#${caseKey}`,
      route: null,
      component: name,
      filePath,
      caseKey,
      title,
      evidence: itemEvidence,
    });
    if (Array.isArray(actions) && actions.length) {
      for (const { handler, event, label } of actions) {
        const title = `${name}: ${humanize(handler)}${label ? ` ("${label}")` : ''} produces its visible result`;
        componentHappy.push({
          ...item('HAPPY', title, [filePath, `handler:${event}`]),
          id: `ui:${name}.${handler}#HAPPY`,
          action: handler,
        });
      }
    } else {
      componentHappy.push(item('HAPPY', `Use ${name}${labels ? ` (${labels})` : ''} and verify its visible result`));
    }
    if (!hasForm) continue;
    componentEdge.push(item('EDGE', `Empty or invalid input in ${name} is rejected`, [...evidence, 'form']));
    if (mutationApi) {
      componentError.push(item('ERROR', `Rejected or failed request from ${name} shows error feedback`, [...evidence, 'api:mutation']));
    }
  }

  for (const route of [...uniqueRoutes].sort()) {
    if (route.includes(':') || route.includes('[')) {
      dynamic.push({
        id: `${route}#HAPPY`,
        route,
        caseKey: 'HAPPY',
        title: `Reach ${route} through in-app navigation and verify its content`,
        evidence: ['route:source', 'route:dynamic'],
      });
      continue;
    }

    const lowerRoute = route.toLowerCase();
    const authRoute = AUTH_ROUTE.test(lowerRoute);
    const formRoute = FORM_ROUTE.test(lowerRoute);
    const hasInputs = inputsByRoute.get(route);
    const formish = hasInputs || formRoute;
    const evidence = ['route:source'];
    if (inputsByRoute.has(route)) evidence.push(hasInputs ? 'snapshot:inputs' : 'snapshot');
    if (authRoute) evidence.push('route-keyword:auth');
    if (formRoute) evidence.push('route-keyword:form');
    if (hasMutationApi) evidence.push('backend:mutation');

    const item = (caseKey, title) => ({ id: `${route}#${caseKey}`, route, caseKey, title, evidence });
    happy.push(item('HAPPY', `Primary journey on ${route} renders its main content`));
    if (authRoute || (hasMutationApi && formish)) {
      auth.push(item('AUTH', `State or auth behaviour on ${route} persists across reload or guards access`));
    }
    if (componentEdge.length) continue;
    if ((authRoute && formish) || (hasMutationApi && hasInputs)) {
      error.push(item('ERROR', `Rejected action on ${route} shows error feedback`));
    }
    if (formish) edge.push(item('EDGE', `Empty or invalid input on ${route} is rejected`));
  }

  const checklist = new Map();
  for (const entry of Array.isArray(validationChecklist) ? validationChecklist : []) {
    const checklistId = entry?.id;
    if (typeof checklistId !== 'string' || !checklistId || checklist.has(checklistId)) continue;
    const field = typeof entry.field === 'object' ? undefined : entry.field;
    const technique = typeof entry.technique === 'object' ? undefined : entry.technique;
    const outcome = entry.expect === 'reject' ? 'rejected' : 'accepted';
    checklist.set(checklistId, {
      id: `check:${checklistId}`,
      route: null,
      caseKey: 'EDGE',
      title: `${String(field)} ${String(technique)} input is ${outcome}`,
      evidence: [entry.source].filter(Boolean),
      checklistId,
    });
  }

  const ordered = [
    ...happy, ...componentHappy, ...auth, ...error, ...componentError, ...edge, ...componentEdge,
    ...checklist.values(), ...dynamic,
  ];
  const limit = typeof maxItems === 'number' && maxItems >= 1 ? maxItems : SYSTEM_PLAN_MAX_ITEMS;
  return {
    version: SYSTEM_PLAN_VERSION,
    items: ordered.slice(0, limit),
    omitted: ordered.slice(limit).map(({ id, route, caseKey, title }) => ({
      id, route, caseKey, title, reason: 'PLAN_LIMIT',
    })),
  };
}

export function extractCoveredPlanIds(code) {
  if (typeof code !== 'string') return [];
  const ids = new Set();
  const lines = code.split(/\r\n|\n|\r/);
  if (lines.at(-1) === '') lines.pop();
  const pending = [];
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) {
      const match = /^\s*\/\/[ \t]*covers[ \t]*:[ \t]*(\S+)/.exec(line);
      if (match) {
        const id = match[1].replace(/^[\[("'`]+|[\])"'`,;.]+$/g, '');
        if (id) pending.push(id);
      }
      continue;
    }
    if (/^\s*(?:test|it)(?:\.(?:only|skip|fixme|fail))?\s*\(/.test(line)) {
      for (const id of pending) ids.add(id);
    }
    pending.length = 0;
  }
  for (const id of pending) ids.add(id);
  return [...ids];
}

export function measureSystemPlanCoverage({ code, plan } = {}) {
  const items = plan?.items || [];
  const found = new Set(extractCoveredPlanIds(code));
  const isCovered = item => found.has(item.id) || (
    typeof item.checklistId === 'string' && item.checklistId.length > 0 && found.has(item.checklistId)
  );
  return {
    total: items.length,
    covered: items.filter(isCovered).map(item => item.id),
    missing: items.filter(item => !isCovered(item)).map(item => item.id),
  };
}

export function summarizeSystemTestPlan(plan) {
  if (!Array.isArray(plan?.items) || plan.items.length === 0) return null;

  const failedItems = [];
  const missingItems = [];
  const coveredItems = [];
  const cases = new Map(['HAPPY', 'EDGE', 'AUTH', 'ERROR'].map(caseKey => [
    caseKey, { caseKey, total: 0, covered: 0 },
  ]));

  for (const item of plan.items) {
    const caseSummary = cases.get(item.caseKey);
    if (caseSummary) caseSummary.total += 1;

    if (item.status === 'COVERED') {
      coveredItems.push(item);
      if (caseSummary) caseSummary.covered += 1;
    } else if (item.status === 'FAILED') {
      failedItems.push(item);
    } else {
      missingItems.push(item);
    }
  }

  const total = plan.items.length;
  const covered = coveredItems.length;
  return {
    total,
    covered,
    failed: failedItems.length,
    missing: missingItems.length,
    omitted: plan.omitted?.length || 0,
    percent: Math.round(covered / total * 100),
    byCase: [...cases.values()].filter(entry => entry.total > 0),
    items: [...failedItems, ...missingItems, ...coveredItems],
  };
}

export function formatSystemPlanForPrompt(plan) {
  if (!plan?.items?.length) return '';
  const heading = `Required test plan (implement exactly one test per item; put a comment exactly like \`// covers: ${plan.items[0].id}\` (plain id, no brackets or quotes) on the line directly above each test(...) call):`;
  const lines = [heading];
  if (plan.items.some(item => item.component)) {
    lines.push('Component items: find the page/route where that component is rendered (follow the source imports) and test it there.');
    lines.push('Action items: trigger exactly that handler through its visible control and assert the user-visible result it produces.');
  }
  for (const { id, caseKey, route, component, filePath, action, title, evidence } of plan.items) {
    const target = component
      ? `component ${component} (${filePath})${action ? `, action ${action}` : ''}`
      : route ?? 'any reachable form';
    lines.push(`- id: ${id} ${caseKey} on ${target}: ${title}. Evidence: ${evidence.join(', ') || 'none'}`);
  }
  return lines.join('\n');
}
