import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { setPrismaClient } from "../../config/prisma.js";

/**
 * Disposable, in-memory PostgreSQL engine via PGlite for auth integration tests.
 * Never reads or connects to remote DATABASE_URL.
 */
export async function createAuthTestDatabase() {
  const serverDir = fileURLToPath(new URL("../../../", import.meta.url));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "covai-auth-test-"));
  const schemaPath = path.join(serverDir, "prisma/schema.prisma");

  const sql = execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      schemaPath,
      "--script",
    ],
    { cwd: serverDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const engine = await PGlite.create();
  await engine.exec(sql);

  const socket = new PGLiteSocketServer({ db: engine, host: "127.0.0.1", port: 0 });
  await socket.start();
  const connection = socket.getServerConn();
  const pool = new Pool({
    connectionString: connection.startsWith("postgres")
      ? connection
      : `postgresql://postgres:postgres@${connection}/postgres`,
    max: 1,
    allowExitOnIdle: true,
  });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  setPrismaClient(db);

  let closed = false;

  return {
    db,
    engine,
    resetAuthTables: async () => {
      await db.githubPendingLink.deleteMany({});
      await db.user.deleteMany({});
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await db.$disconnect();
      await pool.end().catch(() => {});
      await socket.stop();
      await engine.close();
      if (
        path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) &&
        path.basename(temporary).startsWith("covai-auth-test-")
      ) {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    },
  };
}
