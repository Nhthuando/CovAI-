import { describe, it, expect } from '@jest/globals';
import { humanizeVendorToken, vendorTokenForEnvName, vendorTokenForHost } from '../utils/vendorToken.js';

describe('vendorTokenForEnvName', () => {
  it.each([
    ['PAYOS_CLIENT_ID', 'PAYOS'],
    ['VNP_TMN_CODE', 'VNP'],
    ['NEXT_PUBLIC_PAYOS_KEY', 'PAYOS'],
    ['API_PRIVATE_GHN_TOKEN', 'GHN'],
    ['APP_KEY', 'APP'],
    ['NEXT_PUBLIC', 'APP'],
    ['PORT', null],
    ['DB_HOST', null],
    ['JWT_SECRET', null],
  ])('maps %s to %s', (name, token) => {
    expect(vendorTokenForEnvName(name)).toBe(token);
  });
});

describe('vendorTokenForHost', () => {
  it.each([
    ['api-merchant.payos.vn', 'PAYOS'],
    ['sandbox.vnpayment.vn', 'VNPAYMENT'],
    ['API.GHN.COM.VN:443', 'GHN'],
    ['127.0.0.1:3000', null],
    ['[2001:db8::1]:443', null],
    ['::1', null],
    ['localhost:3000', null],
    ['internal', null],
  ])('maps %s to %s', (host, token) => {
    expect(vendorTokenForHost(host)).toBe(token);
  });
});

describe('humanizeVendorToken', () => {
  it.each([
    ['PAYOS', 'Payos'],
    ['GHN', 'GHN'],
    ['APP', 'App settings'],
  ])('labels %s as %s', (token, label) => {
    expect(humanizeVendorToken(token)).toBe(label);
  });
});
