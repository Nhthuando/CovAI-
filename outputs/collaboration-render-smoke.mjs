import { chromium } from '../server/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Users/thuan/.agent-browser/browsers/chrome-153.0.8010.47/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 60000 });
  console.log(JSON.stringify({ url: page.url(), body: (await page.locator('body').innerText()).slice(0, 1600), errors }));
  await page.screenshot({ path: 'outputs/collaboration-render-smoke.png', fullPage: true });
  if (errors.length || !(await page.locator('#root').innerText()).trim()) process.exitCode = 1;
} finally { await browser.close(); }
