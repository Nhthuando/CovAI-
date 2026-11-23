import { describe, it, expect } from '@jest/globals';
import { classifyExternalCalls, classifyExternalDependencies, collectExternalRequirements } from '../services/externalDependencyClassifier.service.js';

const t = Date.parse('2026-01-01T00:00:00.000Z');
const stripeStart = { id: 'call-1', t, event: 'start', host: 'api.stripe.com', method: 'POST' };
const classificationInput = (status, egressEvents, environment) => ({
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
const classify = (...args) => classifyExternalDependencies(classificationInput(...args));

describe('external dependency classifier', () => {
  it('labels a Stripe 401 as a credential failure with unknown configuration', () => {
    const end = { id: stripeStart.id, t: t + 20, event: 'end', status: 401 };
    const input = classificationInput('failed', [stripeStart, end]);
    const { credentialFailures, callFailures } = classifyExternalCalls(input);
    const dependency = {
      services: [{ id: 'stripe', label: 'Stripe' }],
      hosts: ['api.stripe.com'],
      calls: [{ host: 'api.stripe.com', status: 401, code: null }],
      variables: ['STRIPE_SECRET_KEY'],
      configured: null,
      reason: 'AUTH_REJECTED',
    };
    expect(credentialFailures.get('checkout')).toEqual(dependency);
    expect(credentialFailures.get('checkout.spec.js::checkout')).toEqual(dependency);
    expect(callFailures.size).toBe(0);
  });

  it.each([
    ['REQUEST_REJECTED', { event: 'end', status: 400 }, 400, null],
    ['PROVIDER_ERROR', { event: 'end', status: 503 }, 503, null],
    ['UNREACHABLE', { event: 'error', code: 'ECONNRESET' }, null, 'ECONNRESET'],
    ['BACKEND_STOPPED_DURING_EXTERNAL_CALL', null, null, null],
  ])('records %s as a call failure', (category, terminalEvent, status, code) => {
    const events = [stripeStart];
    if (terminalEvent) events.push({ id: stripeStart.id, t: t + 20, ...terminalEvent });
    const input = classificationInput('failed', events);
    const { credentialFailures, callFailures } = classifyExternalCalls(input);
    const failure = {
      services: [{ id: 'stripe', label: 'Stripe' }],
      hosts: ['api.stripe.com'],
      calls: [{ host: 'api.stripe.com', status, code }],
      category,
    };
    expect(credentialFailures.size).toBe(0);
    expect(classifyExternalDependencies(input).size).toBe(0);
    expect(callFailures.get('checkout')).toEqual(failure);
    expect(callFailures.get('checkout.spec.js::checkout')).toEqual(failure);
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
