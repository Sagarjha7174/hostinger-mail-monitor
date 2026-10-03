import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/** Prisma singleton (survives Next dev hot-reload). Shared by app and worker. */
export const prisma: PrismaClient =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
