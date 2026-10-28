import { expect, it } from '@jest/globals';
import { plannedPlaywrightSteps } from '../services/systemTestStepPlan.service.js';

it('includes declared steps after the failure point', () => {
    const source = `test('checkout', async () => {
        await test.step('open', async () => {});
        await test.step('pay', async () => {});
        await test.step('receipt', async () => {});
    });`;
    expect(plannedPlaywrightSteps(source, { title: 'checkout', line: 1 })).toEqual(['open', 'pay', 'receipt']);
});
it.each([
    `test('checkout', async () => { if (ready) await test.step('pay', async () => {}); });`,
    `test('checkout', async () => { for (const item of items) await test.step('pay', async () => {}); });`,
    `test('checkout', async () => { await test.step(label, async () => {}); });`,
    `test('checkout', async () => { await test.step('pay', async () => { await test.step('nested', async () => {}); }); });`,
])('does not invent a denominator for dynamic or ambiguous steps', source => {
    expect(plannedPlaywrightSteps(source, { title: 'checkout' })).toBeNull();
});
it('counts response assignments and repeated labels in declared order', () => {
    expect(plannedPlaywrightSteps(`test('checkout', async () => {
        const response = await test.step('request', async () => request.post('/order'));
        await test.step('verify', async () => expect(response.ok()).toBe(true));
        await test.step('verify', async () => expect(response.status()).toBe(201));
    });`, { title: 'checkout' })).toEqual(['request', 'verify', 'verify']);
});
