import { describe, it, expect } from '@jest/globals';
import { classifyExternalDependencies, collectExternalRequirements } from '../services/externalDependencyClassifier.service.js';

const t = Date.parse('2026-01-01T00:00:00.000Z');
const stripeStart = { id: 'call-1', t, event: 'start', host: 'api.stripe.com', method: 'POST' };
const classify = (status, egressEvents, environment) => classifyExternalDependencies({
  egressEvents,
  environment,
  report: {
    suites: [{
      suites: [{
        specs: [{
          file: 'checkout.spec.js',
          title: 'checkout',
          tests: [{ results: [{ status, startTime: new Date(t).toISOString(), duration: 100 }] }],
        }],
      }],
    }],
  },
});

describe('external dependency classifier', () => {
  it('labels an unfinished Stripe call in a failed test', () => {
    const dependencies = classify('failed', [stripeStart]);
    const dependency = {
      services: [{ id: 'stripe', label: 'Stripe' }],
      hosts: ['api.stripe.com'],
      variables: ['STRIPE_SECRET_KEY'],
      configured: false,
      reason: 'BACKEND_STOPPED_DURING_EXTERNAL_CALL',
    };
    expect(dependencies.get('checkout')).toEqual(dependency);
    expect(dependencies.get('checkout.spec.js::checkout')).toEqual(dependency);
  });

  it.each([
    ['api-merchant.payos.vn', 'env:PAYOS', 'Payos', 'PAYOS_API_KEY'],
    ['api.ghn.com.vn', 'env:GHN', 'GHN', 'GHN_TOKEN'],
  ])('infers a provider for %s', (host, id, label, name) => {
    const start = { ...stripeStart, host };
    const end = { id: start.id, t: t + 20, event: 'end', status: 401 };
    const dependency = classify('failed', [start, end], [
      { name, provider: null, status: 'MISSING' },
      { name: 'PORT', provider: null, status: 'PRESENT' },
    ]).get('checkout');

    expect(dependency).toMatchObject({ services: [{ id, label, host }], variables: [name], configured: false });
    expect(collectExternalRequirements([['checkout', dependency]])).toEqual([
      { id, label, variables: [name], scenarios: ['checkout'] },
    ]);
  });

  it('ignores successful calls in a failed test', () => {
    expect(classify('failed', [stripeStart, { id: stripeStart.id, t: t + 20, event: 'end', status: 200 }]).size).toBe(0);
  });

  it('ignores failed calls in a passed test', () => {
    expect(classify('passed', [stripeStart, { id: stripeStart.id, t: t + 20, event: 'end', status: 401 }]).size).toBe(0);
  });
});
