import { isIP } from 'node:net';

const plumbingName = /^(PORT|HOST|HOSTNAME|NODE_ENV|ENV|DEBUG|LOG_LEVEL|TZ|BASE_URL|APP_URL|CLIENT_URL|FRONTEND_URL|BACKEND_URL|API_URL|CORS_ORIGIN|DATABASE_URL|DB_[A-Z0-9_]+|MONGO[A-Z0-9_]*|MYSQL[A-Z0-9_]*|POSTGRES[A-Z0-9_]*|PG[A-Z0-9_]*|REDIS[A-Z0-9_]*|JWT[A-Z0-9_]*|SESSION[A-Z0-9_]*|COOKIE[A-Z0-9_]*)$/;
const genericTokens = new Set(['APP', 'API', 'SECRET', 'PRIVATE', 'PUBLIC', 'ACCESS', 'CLIENT', 'SERVER', 'NEXT', 'VITE', 'REACT', 'EXPO', 'AUTH', 'SMTP', 'MAIL', 'EMAIL', 'WEBHOOK']);
const countryCodeSuffix = /^(com|co|net|org|gov|edu|ac)\.[a-z]{2}$/;

export const vendorTokenForEnvName = name => {
  const upper = name.toUpperCase();
  if (plumbingName.test(upper)) return null;
  const parts = upper.split('_');
  const vendor = parts.find(part => part && !genericTokens.has(part));
  if (!vendor) return 'APP';
  // Two-part names such as API_KEY or CLIENT_SECRET describe the app itself, not a vendor.
  if (parts.length < 3 && ['APP', 'API', 'SECRET', 'PRIVATE', 'PUBLIC', 'ACCESS', 'CLIENT', 'SERVER', 'AUTH'].includes(parts[0])) return 'APP';
  return parts.length >= 3 ? vendor : parts[0] || vendor;
};

export const vendorTokenForHost = host => {
  const address = host.toLowerCase();
  if (isIP(address)) return null;
  const hostname = address.replace(/:\d+$/, '').replace(/\.$/, '');
  if (hostname === 'localhost' || isIP(hostname.replace(/^\[|\]$/g, ''))) return null;
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some(label => !label)) return null;
  const suffix = labels.slice(-2).join('.');
  const vendor = labels.at(countryCodeSuffix.test(suffix) ? -3 : -2);
  return vendor?.toUpperCase() ?? null;
};

export const humanizeVendorToken = token => {
  if (token === 'APP') return 'App settings';
  return token.length <= 4 ? token : token[0] + token.slice(1).toLowerCase();
};
