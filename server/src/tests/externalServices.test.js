import { describe, test, expect } from '@jest/globals';
import { serviceForEnvName, serviceForHost, serviceForPackage, isLiveCredential } from '../services/externalServiceCatalog.service.js';

describe('external service catalog', () => {
    test('matches providers by variable name, host, and SDK package', () => {
        expect(serviceForEnvName('STRIPE_SECRET_KEY')?.id).toBe('stripe');
        expect(serviceForEnvName('GOOGLE_CLIENT_ID')?.id).toBe('google-oauth');
        expect(serviceForHost('api-m.sandbox.paypal.com')?.id).toBe('paypal');
        expect(serviceForHost('https://github.com/login/oauth/access_token')?.id).toBe('github-oauth');
        expect(serviceForHost('api.stripe.com.example.org')).toBeNull();
        expect(serviceForPackage('firebase/app')?.id).toBe('firebase');
    });

    test('rejects live Stripe credentials for matching variable names only', () => {
        expect(isLiveCredential('STRIPE_SECRET_KEY', 'sk_live_x')).toBe(true);
        expect(isLiveCredential('STRIPE_SECRET_KEY', 'sk_test_x')).toBe(false);
        expect(isLiveCredential('UNKNOWN_KEY', 'sk_live_x')).toBe(false);
    });
});
