import fs from 'node:fs';
import path from 'node:path';
import {containedPath, readFullSystemConfig, startFullSystem} from './fullSystemLifecycle.service.js';
import {ServiceError} from '../utils/serviceError.js';

const ignored = new Set(['node_modules','.git','dist','build','coverage','.covai-temp','.covai-system-test','test-results']);
const sourceExtensions = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte','.html','.sql','.prisma','.py','.go','.java','.cs','.php','.rb']);

export const collectSystemGenerationContext = (rootDir, maxCharacters = 320000) => {
  if(typeof rootDir !== 'string' || !fs.existsSync(rootDir)) throw new ServiceError('The imported snapshot is not ready for system-test generation.',409);
  const configuration = readFullSystemConfig(rootDir);
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      if (entry.isSymbolicLink() || ignored.has(entry.name) || entry.name.startsWith('.env')) continue;
      const file = path.join(directory,entry.name);
      if (entry.isDirectory()) {walk(file);continue;}
      const relative = path.relative(rootDir,file).replace(/\\/g,'/');
      if(/^playwright\.config\./.test(entry.name)) continue;
      if (/\.(test|spec)\./.test(entry.name) || !entry.isFile()) continue;
      if (!sourceExtensions.has(path.extname(file)) && entry.name !== 'package.json' && relative !== '.covai/system-test.json') continue;
      files.push({path:relative,size:fs.statSync(file).size});
    }
  };
  walk(rootDir);
  // UI controls, APIs and schema precede utility/config files; include whole files or report omission.
  const priority = file => /component|page|view|route|controller|App\.|\.sql$|\.prisma$|package.json|system-test.json/i.test(file.path) ? 0 : 1;
  files.sort((a,b)=>priority(a)-priority(b) || a.path.localeCompare(b.path));
  const sourceCode=[];const omittedFiles=[];let characters=0;
  for (const file of files) {
    if (file.size > maxCharacters || characters + file.size > maxCharacters) {omittedFiles.push(file.path);continue;}
    const content=fs.readFileSync(containedPath(rootDir,file.path),'utf8');
    characters += content.length;
    sourceCode.push({path:file.path,content});
  }
  if (!sourceCode.length) throw new ServiceError('No application source was found in the imported snapshot.',422);
  return {configuration,sourceCode,omittedFiles,contextComplete:omittedFiles.length === 0};
};

export const observeSystemApplication = async ({rootDir,jobId}) => {
  const stack = await startFullSystem({rootDir,jobId});
  let browser;
  try {
    const {chromium} = await import('@playwright/test');
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext();
    await context.route('**/api/**',route=>{
      const url=new URL(route.request().url());
      return route.continue({url:stack.backendUrl+url.pathname+url.search});
    });
    const page=await context.newPage();
    const requests=[];
    page.on('response',response=>{
      const url=new URL(response.url());
      if (url.pathname.startsWith('/api/')) requests.push({path:url.pathname,status:response.status(),method:response.request().method()});
    });
    await page.goto(`http://127.0.0.1:${stack.frontendPort}/`,{waitUntil:'load',timeout:30000});
    // Polling/streaming applications may never be network-idle; observation still remains usable.
    await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
    return {title:await page.title(),accessibility:await page.locator('body').ariaSnapshot(),controls:await page.locator('button,input,select,textarea,a').evaluateAll(elements=>elements.map(element=>({tag:element.tagName.toLowerCase(),text:element.innerText?.slice(0,200),label:element.getAttribute('aria-label'),placeholder:element.getAttribute('placeholder'),type:element.getAttribute('type'),href:element.getAttribute('href')}))),requests};
  } finally {
    try {await browser?.close();} finally {await stack.cleanup();}
  }
};
