import { describe, expect, it } from "@jest/globals";
import { validateGeneratedTestCode } from "../validators/aiTestCode.validator.js";

describe("validateGeneratedTestCode", () => {
  it("validates well-formed Playwright ESM test code", () => {
    const code = `
      import { test, expect } from '@playwright/test';

      test('homepage loads successfully', async ({ page }) => {
        await page.goto('http://localhost:4173');
        await expect(page.getByRole('heading')).toBeVisible();
      });
    `;
    const result = validateGeneratedTestCode(code);
    expect(result.valid).toBe(true);
    expect(result.ast).toBeDefined();
  });

  it("validates test code containing JSX and TypeScript annotations", () => {
    const code = `
      import { test, expect } from '@playwright/test';

      interface UserData {
        name: string;
      }

      test('profile renders', async ({ page }) => {
        const user: UserData = { name: 'Alice' };
        await page.goto('/');
        await expect(page.getByText(user.name)).toBeVisible();
      });
    `;
    const result = validateGeneratedTestCode(code);
    expect(result.valid).toBe(true);
  });

  it("rejects empty code", () => {
    expect(() => validateGeneratedTestCode("   "))
      .toThrow(expect.objectContaining({ statusCode: 422, message: expect.stringContaining("empty") }));
  });

  it("rejects invalid JavaScript syntax", () => {
    const code = `import { test from '@playwright/test';`;
    expect(() => validateGeneratedTestCode(code))
      .toThrow(expect.objectContaining({ statusCode: 422, message: expect.stringContaining("syntax") }));
  });

  it("rejects forbidden module import (child_process)", () => {
    const code = `
      import { exec } from 'child_process';
      import { test } from '@playwright/test';
      test('exploit', () => exec('rm -rf /'));
    `;
    expect(() => validateGeneratedTestCode(code))
      .toThrow(expect.objectContaining({ statusCode: 422, message: expect.stringContaining("child_process") }));
  });

  it("rejects forbidden require call (child_process)", () => {
    const code = `
      const cp = require('child_process');
    `;
    expect(() => validateGeneratedTestCode(code))
      .toThrow(expect.objectContaining({ statusCode: 422, message: expect.stringContaining("child_process") }));
  });

  it("rejects eval() calls", () => {
    const code = `
      import { test } from '@playwright/test';
      test('bad', () => {
        eval('alert(1)');
      });
    `;
    expect(() => validateGeneratedTestCode(code))
      .toThrow(expect.objectContaining({ statusCode: 422, message: expect.stringContaining("eval") }));
  });

  it("rejects process.exit() calls", () => {
    const code = `
      import { test } from '@playwright/test';
      test('crash', () => {
        process.exit(1);
      });
    `;
    expect(() => validateGeneratedTestCode(code))
      .toThrow(expect.objectContaining({ statusCode: 422, message: expect.stringContaining("process.exit") }));
  });

  it("rejects fs.rmSync() calls", () => {
    const code = `
      import { test } from '@playwright/test';
      test('delete', () => {
        fs.rmSync('/tmp/foo', { recursive: true });
      });
    `;
    expect(() => validateGeneratedTestCode(code))
      .toThrow(expect.objectContaining({ statusCode: 422, message: expect.stringContaining("fs.rmSync") }));
  });
});
