import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

let prismaClient;

if (process.env.DATABASE_URL) {
    const pool = new Pool({ 
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 30000,
        allowExitOnIdle: true,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
    });
    pool.on("error", (err) => {
        // Neon / PostgreSQL idle connections; handle here to prevent unhandled errors or stale pool clients
        console.warn("[pg-pool] Handled non-fatal pool client error:", err.message);
    });
    const adapter = new PrismaPg(pool);
    const rawClient = new PrismaClient({ adapter });
    prismaClient = rawClient.$extends({
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    let attempts = 0;
                    while (attempts < 2) {
                        try {
                            return await query(args);
                        } catch (error) {
                            attempts++;
                            const isDbUnreachable =
                                error?.code === "P1001" ||
                                error?.message?.includes("Can't reach database server") ||
                                error?.message?.includes("DatabaseNotReachable") ||
                                error?.message?.includes("Connection terminated");
                            if (isDbUnreachable && attempts < 2) {
                                console.warn(`[Prisma] Transient DB connection issue on ${model}.${operation}. Retrying in 1.5s (attempt ${attempts + 1})...`);
                                await new Promise(r => setTimeout(r, 1500));
                                continue;
                            }
                            throw error;
                        }
                    }
                }
            }
        }
    });
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