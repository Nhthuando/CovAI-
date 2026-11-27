import { describe, test, expect } from '@jest/globals';
import {
  SYSTEM_PLAN_MAX_ITEMS,
  SYSTEM_PLAN_VERSION,
  buildSystemTestPlan,
  extractCoveredPlanIds,
  formatSystemPlanForPrompt,
  measureSystemPlanCoverage,
  normalizePlanRoute,
  summarizeSystemTestPlan,
} from '../../../shared/systemTestPlan.js';

const routes = ['/', '/login', '/todos', '/todos/:id', '/files/*', 'about'];
const evidence = {
  routes,
  liveSnapshots: [{ route: '/todos', snapshot: '- textbox "New todo"' }],
  backendEndpoints: [{ method: 'post', path: '/api/todos' }],
};
const orderedIds = [
  '/#HAPPY', '/login#HAPPY', '/todos#HAPPY', '/login#AUTH', '/todos#AUTH',
  '/login#ERROR', '/todos#ERROR', '/login#EDGE', '/todos#EDGE', '/todos/:id#HAPPY',
];
const components = [
  {
    name: 'ArticleList', filePath: 'client/src/components/ArticleList.jsx',
    handlers: ['onClick'], controls: ['Show more'], hasForm: false, mutationApi: false,
  },
  {
    name: 'PaymentPanel', filePath: 'client/src/sandbox/PaymentPanel.jsx',
    handlers: ['onChange', 'onClick'], controls: ['Create checkout'], hasForm: true, mutationApi: true,
    actions: [
      { handler: 'handleCreateCheckout', event: 'onClick', label: 'Create checkout' },
      { handler: 'setSelectedPlanId', event: 'onClick', label: null },
    ],
  },
  {
    name: 'SandboxPage', filePath: 'client/src/sandbox/SandboxPage.jsx',
    handlers: ['onClick'], controls: ['Payments'], hasForm: false, mutationApi: false,
  },
];

describe('buildSystemTestPlan', () => {
  test('includes the root journey with minimal or malformed input', () => {
    const plan = buildSystemTestPlan({});
    expect(plan).toEqual({
      version: SYSTEM_PLAN_VERSION,
      items: [{
        id: '/#HAPPY', route: '/', caseKey: 'HAPPY',
        title: 'Primary journey on / renders its main content', evidence: ['route:source'],
      }],
      omitted: [],
    });
    expect(buildSystemTestPlan()).toEqual(plan);
    expect(buildSystemTestPlan(null)).toEqual(plan);
    expect(buildSystemTestPlan({
      routes: [null, 42], liveSnapshots: 'invalid', validationChecklist: [null], backendEndpoints: {},
    })).toEqual(plan);
  });

  test('prioritizes cases by type and includes every applicable evidence label', () => {
    const { items } = buildSystemTestPlan(evidence);
    expect(items.map(item => item.id)).toEqual(orderedIds);
    for (const item of items.filter(item => item.route === '/login')) {
      expect(item.evidence).toEqual([
        'route:source', 'route-keyword:auth', 'route-keyword:form', 'backend:mutation',
      ]);
    }
    expect(items.find(item => item.id === '/todos#ERROR').evidence).toEqual([
      'route:source', 'snapshot:inputs', 'backend:mutation',
    ]);
    expect(items[0].evidence).toEqual(['route:source', 'backend:mutation']);
    expect(items.at(-1).evidence).toEqual(['route:source', 'route:dynamic']);
  });

  test('only adds HAPPY on a route without applicable evidence', () => {
    const { items } = buildSystemTestPlan({ routes });
    expect(items.map(item => item.id)).toEqual([
      '/#HAPPY', '/login#HAPPY', '/todos#HAPPY', '/login#AUTH',
      '/login#ERROR', '/login#EDGE', '/todos/:id#HAPPY',
    ]);
  });

  test('prioritizes component journeys and gives component forms EDGE and ERROR coverage', () => {
    const { items } = buildSystemTestPlan({
      routes: ['/', '/sandbox'],
      liveSnapshots: [{ route: '/sandbox', snapshot: '- textbox' }],
      backendEndpoints: [{ method: 'POST', path: '/api/payments/checkout' }],
      components,
    });
    expect(items.map(item => item.id)).toEqual([
      '/#HAPPY', '/sandbox#HAPPY', 'ui:ArticleList#HAPPY',
      'ui:PaymentPanel.handleCreateCheckout#HAPPY', 'ui:PaymentPanel.setSelectedPlanId#HAPPY',
      'ui:SandboxPage#HAPPY', '/sandbox#AUTH', 'ui:PaymentPanel#ERROR', 'ui:PaymentPanel#EDGE',
    ]);
    expect(items.slice(-2).map(item => item.evidence)).toEqual([
      [components[1].filePath, 'handler:onChange', 'handler:onClick', 'api:mutation'],
      [components[1].filePath, 'handler:onChange', 'handler:onClick', 'form'],
    ]);
  });

  test('humanizes component action titles in source order', () => {
    const { items } = buildSystemTestPlan({
      components: [{
        ...components[1],
        actions: [
          ...components[1].actions,
          { handler: 'setShowSettings', event: 'onClick', label: null },
          { handler: 'loadRecentPayments', event: 'onClick', label: null },
        ],
      }],
    });
    expect(items.filter(item => item.caseKey === 'HAPPY' && item.component).map(item => item.title)).toEqual([
      'PaymentPanel: create checkout ("Create checkout") produces its visible result',
      'PaymentPanel: change selected plan id produces its visible result',
      'PaymentPanel: toggle show settings produces its visible result',
      'PaymentPanel: load recent payments produces its visible result',
    ]);
  });

  test('keeps route EDGE and ERROR coverage when components have no form', () => {
    const { items } = buildSystemTestPlan({ ...evidence, components: [components[0]] });
    expect(items.map(item => item.id)).toEqual([
      ...orderedIds.slice(0, 3), 'ui:ArticleList#HAPPY', ...orderedIds.slice(3),
    ]);
  });

  test('deduplicates checklist items and places them between route EDGE and dynamic HAPPY', () => {
    const reject = { id: 'email-invalid', field: 'Email', technique: 'format', expect: 'reject', source: 'form.js:12' };
    const accept = { id: 'email-valid', field: 'Email', technique: 'boundary', expect: 'accept' };
    const { items } = buildSystemTestPlan({
      ...evidence, validationChecklist: [reject, { ...reject, source: 'duplicate.js:1' }, accept, { id: '' }],
    });
    expect(items.map(item => item.id)).toEqual([
      ...orderedIds.slice(0, -1), 'check:email-invalid', 'check:email-valid', orderedIds.at(-1),
    ]);
    expect(items.slice(-3, -1)).toEqual([
      {
        id: 'check:email-invalid', route: null, caseKey: 'EDGE', title: 'Email format input is rejected',
        evidence: ['form.js:12'], checklistId: 'email-invalid',
      },
      {
        id: 'check:email-valid', route: null, caseKey: 'EDGE', title: 'Email boundary input is accepted',
        evidence: [], checklistId: 'email-valid',
      },
    ]);
  });

  test('keeps the first three HAPPY items and records the remaining items as omitted', () => {
    const full = buildSystemTestPlan(evidence);
    const { items, omitted } = buildSystemTestPlan({ ...evidence, maxItems: 3 });
    expect(items).toEqual(full.items.slice(0, 3));
    expect(omitted).toEqual(full.items.slice(3).map(({ id, route, caseKey, title }) => ({
      id, route, caseKey, title, reason: 'PLAN_LIMIT',
    })));
  });

  test('defaults to a 60-item limit', () => {
    const plan = buildSystemTestPlan({
      routes: Array.from({ length: 60 }, (_, index) => `/page-${index}`),
    });
    expect(SYSTEM_PLAN_MAX_ITEMS).toBe(60);
    expect(plan.items).toHaveLength(60);
    expect(plan.omitted).toHaveLength(1);
    expect(plan.omitted[0].reason).toBe('PLAN_LIMIT');
  });

  test('is deterministic across calls and route input order', () => {
    const plan = buildSystemTestPlan(evidence);
    expect(buildSystemTestPlan(evidence)).toEqual(plan);
    expect(buildSystemTestPlan({ ...evidence, routes: ['/todos/?x=1', ...[...routes].reverse()] })).toEqual(plan);
  });
});

test.each([
  ['/todos/', '/todos'], ['/a?x=1#h', '/a'], ['//evil', null], ['/x/*', null], ['/', '/'], [42, null],
])('normalizes %p to %p', (route, expected) => {
  expect(normalizePlanRoute(route)).toBe(expected);
});

test('measures coverage in plan order and ignores unknown or duplicate markers', () => {
  const code = '//covers:/login#AUTH\n// covers: /#HAPPY\n// covers: unknown\n// covers: /#HAPPY';
  expect(extractCoveredPlanIds(code)).toEqual(['/login#AUTH', '/#HAPPY', 'unknown']);
  expect(extractCoveredPlanIds(null)).toEqual([]);
  expect(measureSystemPlanCoverage({ code, plan: buildSystemTestPlan(evidence) })).toEqual({
    total: orderedIds.length,
    covered: ['/#HAPPY', '/login#AUTH'],
    missing: orderedIds.filter(id => id !== '/#HAPPY' && id !== '/login#AUTH'),
  });
});

test('counts wrapped markers in the comment run attached to a test', () => {
  const code = [
    '// covers: /#HAPPY',
    '',
    '// covers: [ui:ArticleList.handleExpandClick#HAPPY]',
    '// This test also covers login edge behavior.',
    '// covers: ("/login#EDGE");',
    "test('opens the login form', () => {});",
  ].join('\n');

  expect(extractCoveredPlanIds(code)).toEqual([
    'ui:ArticleList.handleExpandClick#HAPPY',
    '/login#EDGE',
  ]);
});

test('ignores markers before non-test lines and counts a run at the end of input', () => {
  const code = [
    '// covers: /#HAPPY',
    "test.describe('suite', () => {});",
    "// covers: '/login#AUTH',",
    '// covers: `/login#ERROR`.',
    '',
  ].join('\n');

  expect(extractCoveredPlanIds(code)).toEqual(['/login#AUTH', '/login#ERROR']);
});

test('counts a legacy checklist marker toward its canonical plan item', () => {
  const plan = buildSystemTestPlan({ validationChecklist: [{ id: 'password-empty' }] });
  expect(measureSystemPlanCoverage({ code: '// covers: password-empty', plan })).toEqual({
    total: 2,
    covered: ['check:password-empty'],
    missing: ['/#HAPPY'],
  });
});

test('formats every planned item and explains where to put coverage markers', () => {
  const plan = buildSystemTestPlan(evidence);
  const [heading, ...lines] = formatSystemPlanForPrompt(plan).split('\n');
  expect(heading).toContain(`\`// covers: ${plan.items[0].id}\` (plain id, no brackets or quotes) on the line directly above each test(...) call`);
  expect(lines).toHaveLength(plan.items.length);
  plan.items.forEach((item, index) => expect(lines[index]).toContain(`- id: ${item.id} `));
  expect(formatSystemPlanForPrompt({ items: [] })).toBe('');
});

test('formats component items with their source file and reachability guidance', () => {
  const plan = buildSystemTestPlan({ components: components.slice(0, 2) });
  const [, guidance, actionGuidance, , componentLine, actionLine] = formatSystemPlanForPrompt(plan).split('\n');
  expect(guidance).toBe(
    'Component items: find the page/route where that component is rendered (follow the source imports) and test it there.',
  );
  expect(actionGuidance).toBe(
    'Action items: trigger exactly that handler through its visible control and assert the user-visible result it produces.',
  );
  expect(componentLine).toBe(
    '- id: ui:ArticleList#HAPPY HAPPY on component ArticleList (client/src/components/ArticleList.jsx): ' +
    'Use ArticleList (Show more) and verify its visible result. Evidence: client/src/components/ArticleList.jsx, handler:onClick',
  );
  expect(actionLine).toBe(
    '- id: ui:PaymentPanel.handleCreateCheckout#HAPPY HAPPY on component PaymentPanel ' +
    '(client/src/sandbox/PaymentPanel.jsx), action handleCreateCheckout: ' +
    'PaymentPanel: create checkout ("Create checkout") produces its visible result. ' +
    'Evidence: client/src/sandbox/PaymentPanel.jsx, handler:onClick',
  );
});

describe('summarizeSystemTestPlan', () => {
  test.each([null, {}, { items: {} }, { items: [] }])('returns null for %p', plan => {
    expect(summarizeSystemTestPlan(plan)).toBeNull();
  });

  test('counts coverage by case and keeps plan order within each status', () => {
    const items = [
      { id: 'a', caseKey: 'AUTH', status: 'COVERED' },
      { id: 'b', caseKey: 'ERROR', status: 'MISSING' },
      { id: 'c', caseKey: 'EDGE', status: 'FAILED' },
      { id: 'd', caseKey: 'HAPPY', status: 'COVERED' },
      { id: 'e', caseKey: 'EDGE', status: 'UNKNOWN' },
      { id: 'f', caseKey: 'ERROR', status: 'FAILED' },
    ];
    const summary = summarizeSystemTestPlan({ items, omitted: [{ id: 'g' }] });

    expect(summary).toEqual({
      total: 6,
      covered: 2,
      failed: 2,
      missing: 2,
      omitted: 1,
      percent: 33,
      byCase: [
        { caseKey: 'HAPPY', total: 1, covered: 1 },
        { caseKey: 'EDGE', total: 2, covered: 0 },
        { caseKey: 'AUTH', total: 1, covered: 1 },
        { caseKey: 'ERROR', total: 2, covered: 0 },
      ],
      items: [items[2], items[5], items[1], items[4], items[0], items[3]],
    });
    expect(items.map(item => item.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  test('rounds coverage up, skips empty cases, and defaults the omitted count to zero', () => {
    const items = ['COVERED', 'MISSING', 'COVERED'].map(status => ({ caseKey: 'EDGE', status }));
    const summary = summarizeSystemTestPlan({ items });
    expect(summary.percent).toBe(67);
    expect(summary.omitted).toBe(0);
    expect(summary.byCase).toEqual([{ caseKey: 'EDGE', total: 3, covered: 2 }]);
  });
});
