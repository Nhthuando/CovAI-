import dotenv from '../server/node_modules/dotenv/lib/main.js';
dotenv.config({ path: 'server/.env', quiet: true });
const { default: prisma } = await import('../server/src/config/prisma.js');
try {
  const [row] = await prisma.$queryRaw`SELECT ${Buffer.from([1, 2, 3])}::bytea AS bytes, ${['owner', 'dev']}::text[] AS readers, ${JSON.stringify([{ start: 1, end: 1, changeId: 'fixture' }])}::jsonb AS ranges`;
  if (row.bytes.byteLength !== 3 || row.readers.length !== 2 || row.ranges[0].start !== 1) throw new Error('Unexpected Prisma binary/array/JSON encoding');
  console.log('PASS: actual Prisma PostgreSQL codec for binary state, text arrays and line-map JSON; read-only SELECT.');
} finally { await prisma.$disconnect(); }
