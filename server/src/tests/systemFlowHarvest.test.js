import { expect, test } from '@jest/globals';
import { harvestFrontendContext } from '../services/systemGenerationContext.service.js';

const files = entries => Object.entries(entries).map(([path, content]) => ({ path, content }));

test('harvests React Router paths without treating page components as filesystem routes', () => {
  const { routes } = harvestFrontendContext(files({
    'frontend/package.json': '{"dependencies":{"react-router-dom":"^7.0.0"}}',
    'frontend/src/App.jsx': '<Route path="/account" element={<AccountPage />} />',
    'frontend/src/pages/AccountPage.jsx': 'export default () => <h1>Account</h1>;',
    'frontend/src/app/settings/page.jsx': 'export default () => <h1>Settings</h1>;',
  }));

  expect(routes).toContain('/account');
  expect(routes).not.toContain('/AccountPage');
  expect(routes).not.toContain('/settings');
});

test.each([
  ['frontend/package.json', '{"dependencies":{"next":"^15.0.0"}}'],
  ['frontend/next.config.mjs', 'export default {};'],
])('harvests Next.js filesystem routes when %s identifies the project', (filePath, content) => {
  const { routes } = harvestFrontendContext(files({
    [filePath]: content,
    'frontend/pages/about.jsx': 'export default () => <h1>About</h1>;',
    'frontend/app/settings/page.jsx': 'export default () => <h1>Settings</h1>;',
  }));

  expect(routes).toEqual(expect.arrayContaining(['/about', '/settings']));
});

test('harvests manual routes and interactive components reachable from the app entry', () => {
  const { routes, interactiveComponents } = harvestFrontendContext(files({
    'client/src/main.jsx': `
      import App from './App.jsx';
      import SandboxPage from './sandbox/SandboxPage.jsx';
      const pathname = window.location.pathname;
      const isSandboxRoute = pathname === '/sandbox' || pathname.startsWith('/sandbox/');
      createRoot(document.getElementById('root')).render(isSandboxRoute ? <SandboxPage /> : <App />);
    `,
    'client/src/App.jsx': `
      import ArticleList from './components/ArticleList.jsx';
      import MetricCard from './components/MetricCard.jsx';
      axios.get('/api/articles');
      export default function App() {
        return <main><ArticleList /><MetricCard /></main>;
      }
    `,
    'client/src/components/ArticleList.jsx': `
      export default function ArticleList({ id, toggle }) {
        return <button onClick={() => toggle(id)}>Show more</button>;
      }
    `,
    'client/src/components/MetricCard.jsx': 'export default () => <div>Metric</div>;',
    'client/src/sandbox/SandboxPage.jsx': `
      import PaymentPanel from './PaymentPanel.jsx';
      export default function SandboxPage({ selectTab }) {
        return <main><button onClick={() => selectTab('payments')}>Payments</button><PaymentPanel /></main>;
      }
    `,
    'client/src/sandbox/PaymentPanel.jsx': `
      import { createCheckout } from './sandboxApi.js';
      export default function PaymentPanel({ amount, setAmount, plan, setSelectedPlanId }) {
        const handleCreateCheckout = () => createCheckout({ amount });
        return <div>
          <input onChange={event => setAmount(event.target.value)} />
          <button onClick={handleCreateCheckout}>Create checkout</button>
          <button onClick={() => setSelectedPlanId(plan.id)}>{plan.name}</button>
          <button>Custom Amount
            Flexible</button>
        </div>;
      }
    `,
    'client/src/sandbox/sandboxApi.js':
      "const apiClient = axios.create({}); export const createCheckout = b => apiClient.post('/api/x', b);",
    'client/src/Orphan.jsx': 'export default () => <button onClick={handleClick}>Orphan</button>;',
    'client/tests/unit/ArticleList.test.jsx':
      'const fixture = <button onClick={handleClick}>Test</button>; navigate("/test-only");',
    'extension/popup.html': '<button onclick="x()">Go</button>',
  }));

  expect(routes).toEqual(['/', '/sandbox']);
  expect(interactiveComponents.map(component => component.name)).toEqual(['ArticleList', 'PaymentPanel', 'SandboxPage']);
  expect(interactiveComponents[0]).toMatchObject({ hasForm: false, controls: ['Show more'] });
  expect(interactiveComponents[1]).toMatchObject({
    hasForm: true, mutationApi: true, handlers: ['onChange', 'onClick'],
    controls: ['Create checkout', 'Custom Amount Flexible'],
    actions: [
      { handler: 'handleCreateCheckout', event: 'onClick', label: 'Create checkout' },
      { handler: 'setSelectedPlanId', event: 'onClick', label: null },
    ],
  });
});

test('falls back to non-test frontend UI files when no app entry is present', () => {
  const { interactiveComponents } = harvestFrontendContext(files({
    'client/First.vue': '<button @click="open" aria-label="Open panel"><span>Open</span></button>',
    'client/Second.svelte': '<form on:submit={save}><button v-on:click="save">{label}</button></form>',
    'client/Static.jsx': '<button>Static</button>',
    'client/Fixture.spec.tsx': '<button onClick={save}>Fixture</button>',
    'client/__tests__/Demo.jsx': '<button onClick={save}>Demo</button>',
    'server/Panel.jsx': '<button onClick={save}>Server</button>',
    'api/Panel.jsx': '<button onClick={save}>API</button>',
  }));

  expect(interactiveComponents).toMatchObject([
    {
      name: 'First', handlers: ['onClick'], controls: ['Open', 'Open panel'],
      actions: [{ handler: 'open', event: 'onClick', label: 'Open panel' }],
    },
    {
      name: 'Second', handlers: ['onClick', 'onSubmit'], controls: [], hasForm: true,
      actions: [{ handler: 'save', event: 'onSubmit', label: null }],
    },
  ]);
});

test('recognizes literal manual route declarations and skips interpolated and test routes', () => {
  const { routes } = harvestFrontendContext(files({
    'client/navigation.js': [
      "pathname.startsWith('/settings/');",
      'navigate(`/help`);',
      "history.replace('/welcome');",
      "router.push('/account');",
      "window.location.href = '/about';",
      'router.replace(`/items/${id}`);',
    ].join('\n'),
    'client/navigation.cy.js': "location.pathname = '/ignored';",
    'client/tests/pages/fake.jsx': '<Link to="/fixture">Fixture</Link>',
  }));

  expect(routes).toEqual(['/', '/about', '/account', '/help', '/settings', '/welcome']);
});

test('harvests addEventListener actions from plain HTML + JavaScript apps', () => {
  const { interactiveComponents } = harvestFrontendContext(files({
    'client/index.html': '<form id="f"><input id="title"><button type="submit">Add</button></form><script type="module" src="/src/main.js"></script>',
    'client/src/main.js': `document.querySelector('#f').addEventListener('submit', async e => { await fetch('/api/todos', { method: 'POST' }); });
const clear = document.getElementById('clear'); clear.addEventListener('click', onClear);
window.addEventListener('resize', () => {});`,
    'server/index.js': "app.listen(3000); server.addEventListener && 0;",
  }));
  expect(interactiveComponents).toHaveLength(1);
  expect(interactiveComponents[0]).toMatchObject({ name: 'main', hasForm: true, mutationApi: true });
  expect(interactiveComponents[0].actions.map(a => a.handler)).toEqual(['submitF', 'onClear']);
});

test('harvests inline handlers and forms from HTML pages and server-rendered templates', () => {
  const { interactiveComponents } = harvestFrontendContext(files({
    'index.html': '<input id="q"><button onclick="askAI()">Ask</button><button onclick="toggleRawJson()">Raw</button>',
    'views/todos/add.handlebars': '<form action="/todos" method="POST"><input name="title"></form>',
    'views/users/login.ejs': '<form action="/users/login" method="post"><input name="email"></form>',
  }));
  const byName = Object.fromEntries(interactiveComponents.map(c => [c.name, c]));
  expect(byName.index.actions.map(a => a.handler)).toEqual(['askAI', 'toggleRawJson']);
  expect(byName.add.actions).toEqual([{ handler: 'submitTodos', event: 'onSubmit', label: '/todos' }]);
  expect(byName.add.mutationApi).toBe(true);
  expect(byName.login.actions[0].handler).toBe('submitUsersLogin');
});

test('skips browser-extension pages and stray HTML in SPA projects', () => {
  const plain = harvestFrontendContext(files({
    'index.html': '<button onclick="go()">Go</button>',
    'extension/manifest.json': '{"manifest_version":3}',
    'extension/popup.html': '<button onclick="save()">Save</button>',
  }));
  expect(plain.interactiveComponents.map(c => c.name)).toEqual(['index']);
  const spa = harvestFrontendContext(files({
    'src/main.jsx': "import App from './App.jsx'; createRoot(document.getElementById('root')).render(<App />);",
    'src/App.jsx': 'export default () => <button onClick={handleSave}>Save</button>;',
    'demo/legacy.html': '<button onclick="old()">Old</button>',
  }));
  expect(spa.interactiveComponents.map(c => c.name)).toEqual(['App']);
});

test('drops template placeholders and folds /index.html into its directory route', () => {
  const { routes } = harvestFrontendContext(files({
    'views/todos/index.handlebars': '<a href="/todos/edit/{{id}}">Edit</a><a href="/about">About</a><a href="/index.html">Home</a><a href="/docs/index.html">Docs</a>',
  }));
  expect(routes).toEqual(expect.arrayContaining(['/', '/about', '/docs']));
  expect(routes.some(route => /\{\{|index\.html/.test(route))).toBe(false);
});

test('treats Express GET handlers that render views as page routes', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { collectSystemGenerationContext } = await import('../services/systemGenerationContext.service.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-ssr-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ssr', scripts: { start: 'node app.js' }, dependencies: { express: '^4.0.0' } }));
    fs.writeFileSync(path.join(root, 'app.js'), [
      "const express = require('express'); const app = express();",
      "app.get('/', (req, res) => { res.render('index'); });",
      "app.get('/about', (req, res) => { res.render('about'); });",
      "app.get('/api/items', (req, res) => { res.json([]); });",
      "app.post('/items', (req, res) => { res.redirect('/'); });",
      "app.listen(3000);",
    ].join('\n'));
    const { routes } = collectSystemGenerationContext(root);
    expect(routes).toEqual(expect.arrayContaining(['/', '/about']));
    expect(routes).not.toContain('/api/items');
    expect(routes).not.toContain('/items');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
