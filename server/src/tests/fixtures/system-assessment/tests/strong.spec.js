import { test, expect } from '@playwright/test';
test('create persists an item', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Name').fill('verified item');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveText('verified item');
    await page.reload();
    await expect(page.getByRole('listitem')).toHaveText('verified item');
});
test('rejects blank input', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Name').fill('   ');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Name must not be blank');
});
