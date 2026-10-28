import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:55000/api';
const PASSWORD = 'Collaboration-local-123!';

test('a real cross-tab sign-out and account switch clears private project state', async ({ browser, request }) => {
    if (process.env.COLLABORATION_E2E_ENABLED !== 'true') throw new Error('Use the isolated collaboration runner');
    const suffix = randomUUID().slice(0, 8);
    const actors = {};
    for (const actor of ['owner', 'outsider']) {
        const email = `switch-${actor}-${suffix}@covai.test`;
        const response = await request.post(`${API}/auth/register`, { data: { name: `Switch ${actor} ${suffix}`, email, password: PASSWORD } });
        expect(response.ok()).toBe(true);
        actors[actor] = { email, ...(await response.json()) };
    }
    const projectResponse = await request.post(`${API}/projects`, {
        headers: { Authorization: `Bearer ${actors.owner.accessToken}` },
        data: { name: `Private switch project ${suffix}` },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = (await projectResponse.json()).data;
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:55173', viewport: { width: 1440, height: 900 } });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    try {
        const originalTab = await context.newPage();
        await originalTab.goto('/login');
        await originalTab.locator('#auth-email').fill(actors.owner.email);
        await originalTab.locator('#auth-password').fill(PASSWORD);
        await originalTab.locator('#auth-submit-btn').click();
        await expect(originalTab).toHaveURL(/\/projects$/);
        await originalTab.goto(`/main-editor?projectId=${project.id}&tab=settings&setting=members`);
        await expect(originalTab.getByRole('heading', { name: 'Members & access' })).toBeVisible();
        await expect(originalTab.getByText(actors.owner.email, { exact: true })).toBeVisible();

        // Both tabs share the actual browser's storage. Native storage events,
        // rather than synthetic tokens/events, exercise account replacement.
        const accountTab = await context.newPage();
        await accountTab.goto('/projects');
        await accountTab.getByRole('button', { name: 'Sign Out', exact: true }).click();
        await accountTab.getByRole('dialog', { name: 'Sign Out' }).getByRole('button', { name: 'Sign Out', exact: true }).click();
        await expect(originalTab.getByRole('heading', { name: 'Members & access' })).not.toBeVisible();
        await expect(originalTab.getByText(actors.owner.email, { exact: true })).not.toBeVisible();

        await accountTab.goto('/login');
        await accountTab.locator('#auth-email').fill(actors.outsider.email);
        await accountTab.locator('#auth-password').fill(PASSWORD);
        await accountTab.locator('#auth-submit-btn').click();
        await expect(accountTab).toHaveURL(/\/projects$/);
        await expect(originalTab).toHaveURL(/\/projects$/);
        await expect(originalTab.getByText(project.name, { exact: true })).not.toBeVisible();
        await expect(originalTab.getByText(actors.owner.email, { exact: true })).not.toBeVisible();
        const denied = await request.get(`${API}/projects/${project.id}/access`, { headers: { Authorization: `Bearer ${actors.outsider.accessToken}` } });
        expect(denied.status()).toBe(404);
        expect(errors).toEqual([]);
    } finally {
        await context.close();
    }
});
