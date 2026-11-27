import fs from 'node:fs';
import path from 'node:path';

const httpLocalOrigin = /\bhttp:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?(?=[\/"'`\s]|$)/g;
const httpsLocalOrigin = /\bhttps:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?(?=[\/"'`\s]|$)/g;
const skippedDirectories = new Set([
  'node_modules', 'server', 'backend', 'api', 'test', 'tests', '__tests__',
  'e2e', 'cypress', 'dist', 'build', 'coverage',
]);
const skipDirectory = name => name.startsWith('.') || skippedDirectories.has(name.toLowerCase());
const isSourceFile = name => /\.(?:js|jsx|ts|tsx|vue|svelte|html)$/i.test(name) &&
  !/(?:^|[.-])(?:test|spec|cy)\.[^.]+$/i.test(name);

function* readSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !skipDirectory(entry.name)) yield* readSourceFiles(file);
    if (entry.isFile() && isSourceFile(entry.name)) yield { path: file, content: fs.readFileSync(file, 'utf8') };
  }
}

const scanOrigins = ({ rootDir, sourceFiles, frontendPort }) => {
  const httpOrigins = new Set();
  const httpsOrigins = new Set();
  for (const { path: file, content } of sourceFiles ?? readSourceFiles(path.resolve(rootDir))) {
    const relativeFile = rootDir && path.isAbsolute(file) ? path.relative(rootDir, file) : file;
    const parts = relativeFile.split(/[\\/]/);
    if (!isSourceFile(parts.pop()) || parts.some(skipDirectory)) continue;
    for (const [literal] of content.matchAll(httpLocalOrigin)) {
      if (!URL.canParse(literal)) continue;
      const url = new URL(literal);
      if (Number(url.port || 80) !== Number(frontendPort)) httpOrigins.add(url.origin);
    }
    for (const [literal] of content.matchAll(httpsLocalOrigin)) {
      if (URL.canParse(literal)) httpsOrigins.add(new URL(literal).origin);
    }
  }
  return { httpOrigins, httpsOrigins };
};

const withLoopbackAliases = origins => {
  const result = new Set(origins);
  for (const origin of origins) {
    const url = new URL(origin);
    url.hostname = url.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
    result.add(url.origin);
  }
  return [...result];
};

export const detectHardcodedBackendOrigins = options => withLoopbackAliases(scanOrigins(options).httpOrigins);

export const prepareHardcodedBackendForwarding = ({ backendUrl, ...options }) => {
  if (!backendUrl) return [];
  const { httpOrigins, httpsOrigins } = scanOrigins(options);
  for (const origin of httpOrigins) console.info(`Forwarding hardcoded backend URL ${origin} → isolated backend`);
  for (const origin of httpsOrigins) {
    console.warn(`Hardcoded HTTPS backend URL ${origin} cannot be forwarded; set an API URL env variable instead.`);
  }
  return withLoopbackAliases(httpOrigins);
};

export const buildHardcodedBackendForwardingSnippet = ({ origins, backendUrl }) => origins.length ? `
  for (const origin of ${JSON.stringify(origins)}) {
    await context.route(origin + '/**', route => route.continue({
      url: route.request().url().replace(origin, ${JSON.stringify(backendUrl)}),
    }));
  }` : '';
