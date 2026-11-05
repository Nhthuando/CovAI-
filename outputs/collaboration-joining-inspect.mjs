import dotenv from '../server/node_modules/dotenv/lib/main.js';
import pg from '../server/node_modules/pg/lib/index.js';
dotenv.config({ path: 'server/.env', quiet: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
try {
  const snapshot = await pool.query('SELECT "projectId" FROM "ProjectSnapshot" WHERE "id" = $1', ['cmvunmri90001w47klbiwbcao']);
  const projectId = snapshot.rows[0]?.projectId;
  if (!projectId) throw new Error('Snapshot not found');
  const members = await pool.query('SELECT "role", "disciplineRole" FROM "ProjectMember" WHERE "projectId" = $1', [projectId]);
  const docs = await pool.query('SELECT "relativePath", "active", "revision" FROM "ProjectEditorDocument" WHERE "projectId" = $1', [projectId]);
  console.log(JSON.stringify({ liveEditing: process.env.PROJECT_EDITOR_ENABLED, members: members.rows, documents: docs.rows }));
} finally { await pool.end(); }
