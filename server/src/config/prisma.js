import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

let prismaClient;

if (process.env.DATABASE_URL) {
    const pool = new Pool({ 
        connectionString: process.env.DATABASE_URL,
        max: 25,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 25000,
        allowExitOnIdle: true,
    });
    pool.on("error", (err) => {
        // Neon / PostgreSQL idle connections; handle here to prevent unhandled errors or stale pool clients
        console.warn("[pg-pool] Handled non-fatal pool client error:", err.message);
    });
    const adapter = new PrismaPg(pool);
    prismaClient = new PrismaClient({ adapter });
}

const prisma = new Proxy(
    {},
    {
        get(target, prop) {
            if (prop === "then") {
                return undefined;
            }
            if (!prismaClient) {
                throw new Error("Prisma client is not initialized");
            }
            const value = prismaClient[prop];
            return typeof value === "function" ? value.bind(prismaClient) : value;
        },
        set(target, prop, value) {
            if (!prismaClient) {
                throw new Error("Prisma client is not initialized");
            }
            prismaClient[prop] = value;
            return true;
        },
    }
);

export const setPrismaClient = (client) => {
    prismaClient = client;
};

export default prisma;