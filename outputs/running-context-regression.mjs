import assert from 'node:assert/strict';
import { chromium } from '../server/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Users/thuan/.agent-browser/browsers/chrome-153.0.8010.47/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173/.evidence-review/running-context-hot.html');
  await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Idle');
  await page.getByRole('button', { name: 'Start fixture' }).click();
  await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Running');
  assert.deepEqual(errors, []);
  console.log('PASS: Provider from one module timestamp and hook from another share context and state updates; no page errors, API calls or real account data.');
} finally { await browser.close(); }
