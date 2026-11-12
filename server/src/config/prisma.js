import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

let prismaClient;

if (process.env.DATABASE_URL) {
    const connectionString = process.env.DATABASE_URL.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
    const pool = new Pool({ 
        connectionString,
        max: 15,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        allowExitOnIdle: true,
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
                    const maxAttempts = 3;
                    while (attempts < maxAttempts) {
                        try {
                            return await query(args);
                        } catch (error) {
                            attempts++;
                            const msg = String(error?.message || "");
                            const isDbUnreachable =
                                ["P1001", "P1002", "P1008", "P1017", "P2024", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(error?.code) ||
                                msg.includes("Can't reach database server") ||
                                msg.includes("DatabaseNotReachable") ||
                                msg.includes("Connection terminated") ||
                                msg.includes("timeout exceeded when trying to connect") ||
                                msg.includes("Authentication timed out") ||
                                msg.includes("Client has encountered a connection error") ||
                                msg.includes("Timed out fetching a new connection");
                            if (isDbUnreachable && attempts < maxAttempts) {
                                const delayMs = attempts * 500;
                                console.warn(`[Prisma] Transient DB connection issue on ${model}.${operation} (${msg.slice(0, 80)}). Retrying in ${delayMs}ms (attempt ${attempts + 1}/${maxAttempts})...`);
                                await new Promise(r => setTimeout(r, delayMs));
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
