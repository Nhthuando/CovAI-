# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\home.spec.js >> assertion failure is recorded
- Location: e2e\home.spec.js:1:327

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByRole('heading')
Expected: "Wrong"
Received: "System smoke"
Timeout:  100ms

Call log:
  - Expect "toHaveText" getByRole('heading') with timeout 100ms
  - waiting for getByRole('heading')
    3 × locator resolved to <h1>System smoke</h1>
      - unexpected value "System smoke"

```

```yaml
- heading "System smoke" [level=1]
```

# Test source

```ts
> 1 | import { test, expect } from '@playwright/test'; test('public user flow', async ({page}) => { await page.goto('/'); await expect(page.getByRole('heading', {name:'System smoke'})).toBeVisible(); await page.getByRole('button', {name:'Continue'}).click(); await expect(page.getByRole('button', {name:'Done'})).toBeVisible(); }); test('assertion failure is recorded', async ({page}) => { await page.goto('/'); await expect(page.getByRole('heading')).toHaveText('Wrong', {timeout: 100}); });
    |                                                                                                                                                                                                                                                                                                                                                                                                                                                               ^ Error: expect(locator).toHaveText(expected) failed
```