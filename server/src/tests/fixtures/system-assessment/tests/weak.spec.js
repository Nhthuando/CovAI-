import { test, expect } from '@playwright/test';
test('smoke opens the page', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Name').fill('   ');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('body')).toBeVisible();
});
