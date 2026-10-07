import fs from 'node:fs';
import path from 'node:path';
import {containedPath, readFullSystemConfig, startFullSystem} from './fullSystemLifecycle.service.js';
import {extractValidEndpoints} from './apiEndpointParser.service.js';
import {ServiceError} from '../utils/serviceError.js';

const ignored = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.covai-temp',
  '.covai-system-test',
  'test-results',
]);

const sourceExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.html',
  '.sql',
  '.prisma',
  '.json',
]);

/**
 * Scans application source code to harvest frontend routes, UI actions, and API calls.
 *
 * @param {Array<{ path: string, content: string }>} sourceCode
 * @returns {{ routes: string[], clientApiCalls: string[], uiActions: Array<Object> }}
 */
export const harvestFrontendContext = (sourceCode = []) => {
  const routes = new Set(['/']);
  const clientApiCalls = new Set();
  const uiActions = [];

  for (const file of sourceCode) {
    const { path: filePath, content } = file;
    if (!content || typeof content !== 'string') continue;

    // 1. Detect Routes:
    // React Router: <Route path="/login" ... /> or path: "/login" or path: '/login'
    const routeRegex =
      /(?:<Route\s+[^>]*path=["']([^"']+)["']|path\s*:\s*["']([^"']+)["'])/g;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      const route = match[1] || match[2];
      if (
        route &&
        !route.startsWith('http') &&
        !route.includes('*') &&
        !route.startsWith(':')
      ) {
        routes.add(route.startsWith('/') ? route : `/${route}`);
      }
    }

    // Next.js pages/app router structure
    if (/(?:^|\/)pages\/(.+)\.(?:jsx|tsx|js|ts)$/i.test(filePath)) {
      const pageMatch = filePath.match(/(?:^|\/)pages\/(.+)\.(?:jsx|tsx|js|ts)$/i);
      if (
        pageMatch &&
        pageMatch[1] &&
        !pageMatch[1].startsWith('_') &&
        !pageMatch[1].startsWith('api/')
      ) {
        const routePath =
          pageMatch[1] === 'index'
            ? '/'
            : `/${pageMatch[1].replace(/\/index$/, '')}`;
        routes.add(routePath);
      }
    }
    if (/(?:^|\/)app\/(.+)\/page\.(?:jsx|tsx|js|ts)$/i.test(filePath)) {
      const appMatch = filePath.match(/(?:^|\/)app\/(.+)\/page\.(?:jsx|tsx|js|ts)$/i);
      if (appMatch && appMatch[1]) {
        routes.add(`/${appMatch[1]}`);
      }
    }

    // Link / anchor navigation: <Link to="/...">, <router-link to="/...">, <a href="/...">
    const linkRegex =
      /<(?:router-link|NuxtLink|Link|a)\s+[^>]*(?:to|href)=["']([^"']+)["']/gi;
    while ((match = linkRegex.exec(content)) !== null) {
      const route = match[1];
      if (
        route &&
        route.startsWith('/') &&
        !route.startsWith('//') &&
        !route.startsWith('/api') &&
        !route.includes('#')
      ) {
        routes.add(route.split('?')[0]);
      }
    }

    // 2. Detect Client API calls:
    const apiRegex =
      /(?:fetch|axios(?:\.get|\.post|\.put|\.delete|\.patch)?)\s*\(\s*[`"']([^`"']+)[`"']/g;
    while ((match = apiRegex.exec(content)) !== null) {
      const endpoint = match[1];
      if (
        endpoint &&
        (endpoint.startsWith('/api') ||
          endpoint.startsWith('api/') ||
          endpoint.includes('/api/'))
      ) {
        clientApiCalls.add(endpoint);
      }
    }

    // 3. Detect UI Actions (buttons, inputs, forms)
    if (
      /(?:components?|pages?|views?|screens?)\//i.test(filePath) ||
      /(?:App|main)\.[jt]sx?$/i.test(filePath)
    ) {
      const buttons = [];
      const inputs = [];

      const buttonRegex = /<button[^>]*>([\s\S]*?)<\/button>/gi;
      while ((match = buttonRegex.exec(content)) !== null) {
        const text = match[1].replace(/<[^>]+>/g, '').trim();
        if (text && text.length < 40 && !buttons.includes(text)) {
          buttons.push(text);
        }
      }

      const inputRegex =
        /<input[^>]+(?:placeholder|name)=["']([^"']+)["'][^>]*>/gi;
      while ((match = inputRegex.exec(content)) !== null) {
        const inputField = match[1].trim();
        if (inputField && !inputs.includes(inputField)) {
          inputs.push(inputField);
        }
      }

      if (buttons.length > 0 || inputs.length > 0) {
        uiActions.push({
          component: path.basename(filePath),
          filePath,
          buttons: buttons.slice(0, 8),
          inputs: inputs.slice(0, 8),
        });
      }
    }
  }

  return {
    routes: Array.from(routes).sort(),
    clientApiCalls: Array.from(clientApiCalls).sort(),
    uiActions: uiActions.slice(0, 20),
  };
};

/**
 * Collects application context for system test generation from a repository snapshot.
 *
 * @param {string} rootDir
 * @param {number} maxCharacters
 * @returns {Object} Harvested context with sourceCode, routes, uiActions, backendEndpoints
 */
export const collectSystemGenerationContext = (
  rootDir,
  maxCharacters = 320000,
) => {
  if (typeof rootDir !== 'string' || !fs.existsSync(rootDir)) {
    throw new ServiceError(
      'The imported snapshot is not ready for system-test generation.',
      409,
    );
  }

  // Gracefully read configuration if present, otherwise auto-detect
  let configuration = null;
  try {
    configuration = readFullSystemConfig(rootDir);
  } catch {
    const hasClient = fs.existsSync(path.join(rootDir, 'client'));
    configuration = {
      isAutoDetected: true,
      frontend: { directory: hasClient ? 'client' : '.' },
      backend: { directory: fs.existsSync(path.join(rootDir, 'server')) ? 'server' : '.' },
    };
  }

  const files = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.isSymbolicLink() ||
        ignored.has(entry.name) ||
        entry.name.startsWith('.env')
      )
        continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      const relative = path.relative(rootDir, file).replace(/\\/g, '/');
      if (/^(?:playwright|cypress)\.config\./.test(entry.name)) continue;
      if (/\.(test|spec|cy)\./.test(entry.name) || !entry.isFile()) continue;
      if (
        !sourceExtensions.has(path.extname(file)) &&
        entry.name !== 'package.json' &&
        relative !== '.covai/system-test.json'
      )
        continue;
      try {
        files.push({ path: relative, size: fs.statSync(file).size });
      } catch {
        // Ignore file stat errors
      }
    }
  };
  walk(rootDir);

  // Prioritize page components, routes, and controllers
  const priority = (file) =>
    /component|page|view|route|controller|App\.|\.sql$|\.prisma$|package.json|system-test.json/i.test(
      file.path,
    )
      ? 0
      : 1;
  files.sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));

  const sourceCode = [];
  const omittedFiles = [];
  let characters = 0;

  for (const file of files) {
    if (file.size > maxCharacters || characters + file.size > maxCharacters) {
      omittedFiles.push(file.path);
      continue;
    }
    try {
      const full = path.join(rootDir, file.path);
      const content = fs.readFileSync(full, 'utf8');
      characters += content.length;
      sourceCode.push({ path: file.path, content });
    } catch {
      omittedFiles.push(file.path);
    }
  }

  if (!sourceCode.length) {
    throw new ServiceError(
      'No application source was found in the imported snapshot.',
      422,
    );
  }

  // Harvest frontend UI context & backend endpoints
  const frontendHarvest = harvestFrontendContext(sourceCode);
  let backendEndpoints = [];
  try {
    backendEndpoints = extractValidEndpoints(sourceCode);
  } catch {
    backendEndpoints = [];
  }

  return {
    configuration,
    sourceCode,
    omittedFiles,
    contextComplete: omittedFiles.length === 0,
    routes: frontendHarvest.routes,
    uiActions: frontendHarvest.uiActions,
    clientApiCalls: frontendHarvest.clientApiCalls,
    backendEndpoints,
  };
};

export const observeSystemApplication = async ({ rootDir, jobId }) => {
  const stack = await startFullSystem({ rootDir, jobId });
  let browser;
  try {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      return route.continue({
        url: stack.backendUrl + url.pathname + url.search,
      });
    });
    const page = await context.newPage();
    const requests = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/'))
        requests.push({
          path: url.pathname,
          status: response.status(),
          method: response.request().method(),
        });
    });
    await page.goto(`http://127.0.0.1:${stack.frontendPort}/`, {
      waitUntil: 'load',
      timeout: 30000,
    });
    await page
      .waitForLoadState('networkidle', { timeout: 5000 })
      .catch(() => {});
    return {
      title: await page.title(),
      accessibility: await page.locator('body').ariaSnapshot(),
      controls: await page
        .locator('button,input,select,textarea,a')
        .evaluateAll((elements) =>
          elements.map((element) => ({
            tag: element.tagName.toLowerCase(),
            text: element.innerText?.slice(0, 200),
            label: element.getAttribute('aria-label'),
            placeholder: element.getAttribute('placeholder'),
            type: element.getAttribute('type'),
            href: element.getAttribute('href'),
          })),
        ),
      requests,
    };
  } finally {
    try {
      await browser?.close();
    } finally {
      await stack.cleanup();
    }
  }
};
