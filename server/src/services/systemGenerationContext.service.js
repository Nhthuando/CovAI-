import { extractValidationFacts, buildTestDesignChecklist } from './systemValidationFacts.service.js';
import fs from 'node:fs';
import path from 'node:path';
import {startFullSystem} from './fullSystemLifecycle.service.js';
import {containedPath, readFullSystemConfig, resolveSystemRepositoryRoot} from './fullSystemConfig.service.js';
import {extractValidEndpoints} from './apiEndpointParser.service.js';
import {ServiceError} from '../utils/serviceError.js';
import {runtimeIgnoredDirectories} from './projectRuntimePlan.service.js';
import {fileURLToPath} from 'node:url';
import {prepareHardcodedBackendForwarding} from './hardcodedBackendOrigins.service.js';

const ignored = new Set([
  ...runtimeIgnoredDirectories,
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
  // Server-rendered view templates (Express + EJS/Handlebars/Nunjucks).
  '.ejs',
  '.hbs',
  '.handlebars',
  '.njk',
  '.sql',
  '.prisma',
  '.json',
]);

const isStaticAsset = (pathStr) =>
  /\.(?:svg|png|jpe?g|gif|ico|webp|avif|css|js|mjs|cjs|map|json|woff2?|ttf|eot|otf|pdf|zip|gz|xml|txt)$/i.test(pathStr);

const isTestFile = (filePath) =>
  /(^|\/)(tests?|__tests__|e2e|cypress|playwright)\//i.test(filePath) ||
  /\.(test|spec|cy)\.[cm]?[jt]sx?$/i.test(filePath);

const uiExtensions = ['.jsx', '.tsx', '.js', '.ts', '.vue', '.svelte'];
const appEntry = /\b(createRoot|ReactDOM\.render|hydrateRoot|createApp|new Vue)\s*\(/;
const mutationCall = /\b[\w$]*(?:axios|api|http|client|request|fetcher)[\w$]*\.(?:post|put|patch|delete)\s*\(|method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i;

const cleanControlLabel = (label) => {
  const text = label?.replace(/\s+/g, ' ').trim();
  return text && text.length <= 40 && !/[{}]/.test(text) ? text : null;
};

const quotedAttribute = String.raw`"[^"]*"|'[^']*'`;
const expressionToken = String.raw`[^{}"'\x60]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60[^\x60]*\x60`;
const jsxAttribute = String.raw`\{(?:${expressionToken}|\{(?:${expressionToken}|\{(?:${expressionToken})*\})*\})*\}`;
const actionTags = new RegExp(
  String.raw`<([A-Za-z][\w.:-]*)(?=[\s/>])((?:[^<>"'{]|${quotedAttribute}|${jsxAttribute})*?)(/?>)`,
  'g',
);
const tagAttributes = new RegExp(
  String.raw`(?:^|\s)([^\s=]+)\s*=\s*(${quotedAttribute}|${jsxAttribute}|[^\s]+)`,
  'g',
);
const actionEvents = {
  click: 'onClick', submit: 'onSubmit', dblclick: 'onDoubleClick',
};

const harvestComponentActions = (content, isSvelte) => {
  const actions = new Map();
  for (const tag of content.matchAll(actionTags)) {
    const [, name, attributes, end] = tag;
    const attributesWithValues = [...attributes.matchAll(tagAttributes)];
    for (const [, attribute, value] of attributesWithValues) {
      const event = /^(?:onClick|onSubmit|onDoubleClick)$/.test(attribute)
        ? attribute
        : actionEvents[attribute.match(/^(?:@|v-on:|on:)(click|submit|dblclick)(?:[.|].*)?$/)?.[1]
          ?? (isSvelte ? attribute.match(/^on(click|submit|dblclick)$/)?.[1] : undefined)];
      if (!event) continue;

      const expression = value.replace(/^\{([\s\S]*)\}$|^(["'])([\s\S]*)\2$/, '$1$3').trim();
      const callback = expression.replace(/^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*/, '');
      const reference = expression.match(/^(?:[\w$]+\s*\.\s*)*([A-Za-z_$][\w$]*)$/)?.[1];
      const call = callback.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60[^\x60]*\x60/g, ' ')
        .match(/(?<![\w$])(?!(?:if|for|while|switch|catch|with|function|await|return|typeof)\b)([A-Za-z_$][\w$]*)\s*\(/);
      const handler = reference ?? call?.[1];
      if (!handler || actions.has(handler)) continue;

      const body = end === '>' && /^(?:button|a)$/i.test(name)
        ? content.slice(tag.index + tag[0].length).match(/^((?:(?!<\/)[\s\S])*)<\/(button|a)\s*>/i)
        : undefined;
      const buttonText = body?.[2].toLowerCase() === name.toLowerCase() ? body[1].replace(/<[^>]+>/g, '') : null;
      const aria = attributesWithValues.find(([, key]) => key.toLowerCase() === 'aria-label')?.[2];
      const ariaLabel = aria?.match(/^(["'])([\s\S]*)\1$/)?.[2];
      const label = cleanControlLabel(buttonText) ?? cleanControlLabel(ariaLabel);
      actions.set(handler, { handler, event, label });
      if (actions.size === 12) return [...actions.values()];
    }
  }
  return [...actions.values()];
};

// Plain HTML + JavaScript apps attach behaviour with addEventListener instead of JSX props.
const scriptExtensions = new Set(['.js', '.mjs', '.cjs', '.ts']);
const domListener = /([A-Za-z_$][\w$]*|document\s*\.\s*(?:querySelector|getElementById)\(\s*(["'`])([^"'`]+)\2\s*\))\s*(?:\?\.|\.)\s*addEventListener\(\s*(["'`])(click|submit|dblclick)\4\s*,\s*(async\s+)?(?:function\s*([A-Za-z_$][\w$]*)?|([A-Za-z_$][\w$]*)\s*[,)])?/g;
const toIdentifier = (text) => {
  const words = String(text || '').replace(/^[#.]/, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map(word => word[0].toUpperCase() + word.slice(1)).join('');
};

const harvestVanillaDomComponents = (files, alreadyHarvested) => {
  const htmlHasForm = [...files.values()].some(({ path: filePath, content }) =>
    /\.html?$/i.test(filePath) && !isTestFile(filePath.replace(/\\/g, '/')) && /<(?:input|textarea|select|form)\b/i.test(content));
  const components = [];
  const extensionRoots = browserExtensionRoots(files);
  for (const [filePath, { content, path: sourcePath }] of files) {
    if (!scriptExtensions.has(path.posix.extname(filePath).toLowerCase())) continue;
    if (alreadyHarvested.has(filePath) || isTestFile(filePath) || /(^|\/)(server|backend)\/|^api\//i.test(filePath)) continue;
    if (insideAny(filePath, extensionRoots)) continue;
    if (!/addEventListener\(/.test(content) || !/\bdocument\b/.test(content)) continue;
    const actions = new Map();
    for (const match of content.matchAll(domListener)) {
      const [, target, , selector, , event, , namedFunction, reference] = match;
      const handler = reference || namedFunction || `${event}${toIdentifier(selector || target) || 'Page'}`;
      if (!/^[A-Za-z_$][\w$]*$/.test(handler) || actions.has(handler)) continue;
      actions.set(handler, { handler, event: actionEvents[event], label: selector ? cleanControlLabel(selector) : null });
      if (actions.size === 12) break;
    }
    if (!actions.size) continue;
    components.push({
      name: path.posix.basename(filePath, path.posix.extname(filePath)),
      filePath: sourcePath,
      handlers: [...new Set([...actions.values()].map(action => action.event))].sort(),
      controls: [],
      actions: [...actions.values()],
      hasForm: htmlHasForm || /\.value\b|FormData\(/.test(content),
      mutationApi: mutationCall.test(content),
    });
  }
  return components;
};

// HTML pages and server-rendered templates: inline on* handlers and <form> submissions.
const markupExtensions = new Set(['.html', '.htm', '.ejs', '.hbs', '.handlebars', '.njk']);
const inlineHandler = /\bon(click|submit|dblclick)\s*=\s*["']\s*(?:return\s+)?([A-Za-z_$][\w$.]*)\s*\(/gi;
const formTag = /<form\b([^>]*)>/gi;
const attributeValue = (attributes, name) =>
  attributes.match(new RegExp(String.raw`\b${name}\s*=\s*(["'])(.*?)\1`, 'i'))?.[2];

// Browser extensions (a folder with a manifest.json declaring manifest_version) are not part of the web app.
const browserExtensionRoots = (files) => [...files]
  .filter(([filePath, { content }]) => path.posix.basename(filePath) === 'manifest.json' && /"manifest_version"\s*:/.test(content))
  .map(([filePath]) => path.posix.dirname(filePath));
const insideAny = (filePath, roots) => roots.some(root => root === '.' || filePath.startsWith(root + '/'));

const harvestMarkupComponents = (files, { scriptHandlesSubmit = false } = {}) => {
  const components = [];
  const extensionRoots = browserExtensionRoots(files);
  for (const [filePath, { content, path: sourcePath }] of files) {
    if (!markupExtensions.has(path.posix.extname(filePath).toLowerCase()) || isTestFile(filePath)) continue;
    if (insideAny(filePath, extensionRoots)) continue;
    const actions = new Map();
    for (const [, event, callee] of content.matchAll(inlineHandler)) {
      const handler = callee.split('.').pop();
      if (!actions.has(handler)) actions.set(handler, { handler, event: actionEvents[event.toLowerCase()], label: null });
    }
    let mutatingForm = false;
    for (const [, attributes] of content.matchAll(formTag)) {
      const action = attributeValue(attributes, 'action');
      const method = (attributeValue(attributes, 'method') || 'get').toLowerCase();
      if (method !== 'get') mutatingForm = true;
      // A form without an action is submitted by page script; that listener is already one action.
      if (!action && scriptHandlesSubmit) continue;
      const handler = `submit${toIdentifier(action && !/[{}<%]/.test(action) ? action : '') || 'Form'}`;
      if (!actions.has(handler)) actions.set(handler, { handler, event: 'onSubmit', label: action && !/[{}<%]/.test(action) ? cleanControlLabel(action) : null });
    }
    if (!actions.size) continue;
    components.push({
      name: path.posix.basename(filePath, path.posix.extname(filePath)),
      filePath: sourcePath,
      handlers: [...new Set([...actions.values()].map(action => action.event))].sort(),
      controls: [],
      actions: [...actions.values()].slice(0, 12),
      hasForm: /<(?:input|textarea|select|form)\b/i.test(content),
      mutationApi: mutatingForm || /name\s*=\s*["']_method["']/i.test(content) || mutationCall.test(content),
    });
  }
  return components;
};

// Express apps that render pages on the server expose their pages as GET handlers calling res.render/sendFile.
const serverRenderedPageRoutes = (sourceCode, endpoints) => {
  const contents = new Map(sourceCode.map(file => [String(file.path).replace(/\\/g, '/'), file.content || '']));
  const nextRoute = /^\s*(?:router|app|[A-Za-z_$][\w$]*Router)\s*\.\s*(?:get|post|put|patch|delete|use|all|route)\s*\(/;
  const routes = new Set();
  for (const endpoint of endpoints || []) {
    if (String(endpoint?.method || '').toUpperCase() !== 'GET') continue;
    const route = endpoint.fullPath || endpoint.path;
    if (typeof route !== 'string' || !route.startsWith('/') || /^\/api(\/|$)/i.test(route) || route.includes('*')) continue;
    const content = contents.get(String(endpoint.sourceFile || '').replace(/\\/g, '/'));
    const start = Number(endpoint.sourceLine);
    if (!content || !Number.isInteger(start) || start < 1) continue;
    const lines = content.split(/\r?\n/).slice(start - 1, start + 40);
    const end = lines.findIndex((line, index) => index > 0 && nextRoute.test(line));
    const handler = (end === -1 ? lines : lines.slice(0, end)).join('\n');
    if (/\bres\s*\.\s*(?:render|sendFile)\s*\(/.test(handler)) routes.add(route.replace(/\/+$/, '') || '/');
  }
  return [...routes];
};

const harvestInteractiveComponents = (sourceCode) => {
  const files = new Map(sourceCode
    .filter(({ path: filePath, content }) => typeof filePath === 'string' && typeof content === 'string')
    .map(file => [file.path.replace(/\\/g, '/'), file]));
  const uiFiles = new Map([...files].filter(([filePath, { content }]) =>
    uiExtensions.includes(path.posix.extname(filePath).toLowerCase()) &&
    !isTestFile(filePath) &&
    !/(^|\/)(server|backend)\/|^api\//i.test(filePath) &&
    /<[A-Za-z][\w.]*[\s>\/]/.test(content),
  ));
  const importsByFile = new Map();
  const entries = [];
  for (const [filePath, { content }] of uiFiles) {
    if (appEntry.test(content)) entries.push(filePath);
    const imports = [];
    const relativeImport = /\b(?:import\s+[^"'`;()]+?\s+from\s*|(?:import|require)\s*\(\s*)["'](\.[^"']+)["']/g;
    for (const [, specifier] of content.matchAll(relativeImport)) {
      const base = path.posix.join(path.posix.dirname(filePath), specifier);
      const candidates = [
        base,
        ...uiExtensions.map(extension => base + extension),
        ...uiExtensions.map(extension => path.posix.join(base, 'index' + extension)),
      ];
      const resolved = candidates.find(candidate => files.has(candidate));
      if (resolved) imports.push(resolved);
    }
    importsByFile.set(filePath, imports);
  }

  const reachable = new Set(entries.length ? entries : uiFiles.keys());
  // Set iteration also visits paths added by previously visited files.
  for (const filePath of reachable) {
    for (const importedPath of importsByFile.get(filePath)) {
      if (uiFiles.has(importedPath)) reachable.add(importedPath);
    }
  }

  const components = [];
  const nameCounts = new Map();
  for (const filePath of [...reachable].sort()) {
    const { content, path: sourcePath } = uiFiles.get(filePath);
    const handlers = new Set();
    for (const [, handler] of content.matchAll(/(?:^|\s)(onClick|onSubmit|onChange|onInput|onKeyDown|onBlur)\s*=/g)) {
      handlers.add(handler);
    }
    for (const [, event] of content.matchAll(/(?:^|\s)(?:@|v-on:|on:)(click|submit|change|input)(?=[\s=>.]|$)/g)) {
      handlers.add('on' + event[0].toUpperCase() + event.slice(1));
    }
    const actions = harvestComponentActions(content, /\.svelte$/i.test(filePath));
    if (!handlers.size && !actions.length) continue;

    const controls = new Set();
    const buttons = /<button\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*?)(?:\/>|>([\s\S]*?)<\/button\s*>|>)/gi;
    for (const [, attributes, body] of content.matchAll(buttons)) {
      const label = attributes.match(/\saria-label\s*=\s*(["'])(.*?)\1/i)?.[2];
      for (const candidate of [body?.replace(/<[^>]+>/g, ''), label]) {
        const control = cleanControlLabel(candidate);
        if (control) controls.add(control);
        if (controls.size === 6) break;
      }
      if (controls.size === 6) break;
    }

    const name = path.posix.basename(filePath, path.posix.extname(filePath));
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    components.push({
      name,
      filePath: sourcePath,
      handlers: [...handlers].sort(),
      controls: [...controls],
      actions,
      hasForm: /<(?:input|textarea|select|form)\b|\bcontentEditable\b/i.test(content),
      mutationApi: mutationCall.test(content) ||
        importsByFile.get(filePath).some(importedPath => mutationCall.test(files.get(importedPath).content)),
    });
  }

  // SPA projects (React/Vue entry found) keep all UI in components; stray HTML pages or scripts
  // (extension popups, demos) are not part of the app. Plain HTML/JS and server-rendered apps use the scanners below.
  if (!entries.length) {
    const vanilla = harvestVanillaDomComponents(files, new Set(components.map(component => component.filePath.replace(/\\/g, '/'))));
    components.push(...vanilla);
    components.push(...harvestMarkupComponents(files, {
      scriptHandlesSubmit: vanilla.some(component => component.actions.some(action => action.event === 'onSubmit')),
    }));
  }
  nameCounts.clear();
  for (const component of components) nameCounts.set(component.name, (nameCounts.get(component.name) || 0) + 1);

  return components.slice(0, 40).map(component => {
    if (nameCounts.get(component.name) === 1) return component;
    const parent = path.posix.basename(path.posix.dirname(component.filePath.replace(/\\/g, '/')));
    return { ...component, name: parent + '/' + component.name };
  });
};

/**
 * Scans application source code to harvest frontend routes, UI actions, components, and API calls.
 *
 * @param {Array<{ path: string, content: string }>} sourceCode
 * @returns {{ routes: string[], clientApiCalls: string[], uiActions: Array<Object>, interactiveComponents: Array<Object> }}
 */
export const harvestFrontendContext = (sourceCode = []) => {
  const routes = new Set(['/']);
  const isNextProject = sourceCode.some(({ path: filePath, content }) => {
    if (/(?:^|[\\/])next\.config\.(?:js|mjs|ts|cjs)$/i.test(filePath)) return true;
    if (!/(?:^|[\\/])package\.json$/i.test(filePath)) return false;
    try {
      const { dependencies, devDependencies } = JSON.parse(content) ?? {};
      return Object.hasOwn(dependencies ?? {}, 'next') || Object.hasOwn(devDependencies ?? {}, 'next');
    } catch {
      return false;
    }
  });

  const addCandidateRoute = (candidate) => {
    if (!candidate || typeof candidate !== 'string') return;
    const pathOnly = candidate.split('?')[0].split('#')[0].trim();
    if (
      !pathOnly ||
      pathOnly.startsWith('http') ||
      pathOnly.startsWith('//') ||
      pathOnly.startsWith('/api') ||
      pathOnly.startsWith('api/') ||
      pathOnly.includes('*') ||
      pathOnly.startsWith(':') ||
      // Template placeholders (`/todos/edit/{{id}}`, `<%= id %>`, `${id}`) are not navigable routes.
      /\{\{|<%|\$\{/.test(pathOnly) ||
      isStaticAsset(pathOnly)
    ) {
      return;
    }
    const route = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    // `/index.html` is the same page as `/`; keep one route per page.
    routes.add(route.replace(/\/index\.html?$/i, '') || '/');
  };
  const clientApiCalls = new Set();
  const uiActions = [];

  for (const file of sourceCode) {
    const { path: filePath, content } = file;
    if (!content || typeof content !== 'string') continue;

    // 1. Detect Routes:
    const routeFilePath = typeof filePath === 'string' ? filePath.replace(/\\/g, '/') : '';
    const testFile = isTestFile(routeFilePath);
    const addRoute = (candidate) => {
      if (!testFile) addCandidateRoute(candidate);
    };
    if (!testFile) {
      const pathnamePrefix = /\bpathname\.startsWith\(\s*["'`](\/[^"'`]*)["'`]/g;
      const manualRoutes = [
        /\bpathname\s*(?:===|==)\s*["'`](\/[^"'`]*)["'`]/g,
        pathnamePrefix,
        /\b(?:navigate|history\.push|history\.replace|router\.push|router\.replace)\(\s*["'`](\/[^"'`]*)["'`]/g,
        /\blocation\.(?:href|pathname)\s*=\s*["'`](\/[^"'`]*)["'`]/g,
      ];
      for (const pattern of manualRoutes) {
        for (const [, route] of content.matchAll(pattern)) {
          if (!route.includes('${')) addRoute(pattern === pathnamePrefix ? route.replace(/\/$/, '') || '/' : route);
        }
      }
    }
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
        addRoute(route);
      }
    }

    // Next.js pages/app router structure
    if (isNextProject && /(?:^|\/)pages\/(.+)\.(?:jsx|tsx|js|ts)$/i.test(routeFilePath)) {
      const pageMatch = routeFilePath.match(/(?:^|\/)pages\/(.+)\.(?:jsx|tsx|js|ts)$/i);
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
        addRoute(routePath);
      }
    }
    if (isNextProject && /(?:^|\/)app\/(.+)\/page\.(?:jsx|tsx|js|ts)$/i.test(routeFilePath)) {
      const appMatch = routeFilePath.match(/(?:^|\/)app\/(.+)\/page\.(?:jsx|tsx|js|ts)$/i);
      if (appMatch && appMatch[1]) {
        addRoute(`/${appMatch[1]}`);
      }
    }

    // Component Link navigation: <Link to="/...">, <router-link to="/...">, <NuxtLink to="/...">
    // (Notice: case-sensitive tag name so it won't match HTML <link rel="icon" href="...">)
    const componentLinkRegex =
      /<(?:router-link|NuxtLink|Link)\s+[^>]*to=["']([^"']+)["']/g;
    while ((match = componentLinkRegex.exec(content)) !== null) {
      addRoute(match[1]);
    }

    // HTML anchor navigation: <a href="/...">
    const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["']/gi;
    while ((match = anchorRegex.exec(content)) !== null) {
      addRoute(match[1]);
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
      /\.(?:jsx?|tsx?|vue|svelte|html)$/i.test(filePath)
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
    interactiveComponents: harvestInteractiveComponents(sourceCode),
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

  rootDir = resolveSystemRepositoryRoot(rootDir);

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
      if (['package-lock.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb'].includes(entry.name)) continue;
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
  let validationFacts = [];
  let testDesign = [];
  try {
    validationFacts = extractValidationFacts({ files: sourceCode });
    testDesign = buildTestDesignChecklist({ facts: validationFacts });
  } catch (error) {
    console.warn('[systemGenerationContext] Validation fact extraction failed:', error);
    validationFacts = [];
    testDesign = [];
  }
  let backendEndpoints = [];
  try {
    backendEndpoints = extractValidEndpoints(sourceCode);
  } catch (error) {
    console.warn('[systemGenerationContext] Backend endpoint extraction failed:', error);
    backendEndpoints = [];
  }
  const routes = [...new Set([...frontendHarvest.routes, ...serverRenderedPageRoutes(sourceCode, backendEndpoints)])].sort();

  return {
    configuration,
    sourceCode,
    omittedFiles,
    contextComplete: omittedFiles.length === 0,
    routes,
    uiActions: frontendHarvest.uiActions,
    interactiveComponents: frontendHarvest.interactiveComponents,
    clientApiCalls: frontendHarvest.clientApiCalls,
    backendEndpoints,
    validationFacts,
    testDesign,
  };
};

export const observeSystemApplication = async ({ rootDir, jobId, environmentRoot, signal }) => {
  const stack = await startFullSystem({ rootDir, jobId, environmentRoot, signal });
  let browser;
  try {
    const {preparePlaywrightBrowsers}=await import('./systemTestRunner.service.js');
    const browserEnv=await preparePlaywrightBrowsers(fileURLToPath(new URL('../../',import.meta.url)),jobId,{signal});
    const { chromium } = await import('@playwright/test');
    const executable=chromium.executablePath().split(path.sep),revision=executable.findIndex(part=>/^chromium-\d+$/.test(part));
    const executablePath=revision<0?chromium.executablePath():path.join(browserEnv.PLAYWRIGHT_BROWSERS_PATH,...executable.slice(revision));
    browser = await chromium.launch({ headless: true,executablePath });
    const { backendUrl, frontendPort, frontendRoot = rootDir } = stack;
    const origins = prepareHardcodedBackendForwarding({ rootDir: frontendRoot, backendUrl, frontendPort });
    const frontendUrl = `http://127.0.0.1:${frontendPort}`;
    const context = await browser.newContext(origins.length ? { serviceWorkers: 'block' } : {});
    await context.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== frontendUrl) return route.continue();
      return route.continue({
        url: backendUrl + url.pathname + url.search,
      });
    });
    for (const origin of origins) {
      await context.route(origin + '/**', route => route.continue({
        url: route.request().url().replace(origin, backendUrl),
      }));
    }
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
    await page.goto(`${frontendUrl}/`, {
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
