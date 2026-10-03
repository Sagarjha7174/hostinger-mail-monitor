import { PrismaClient } from "@prisma/client";
import { runSync } from "../src/lib/sync/runner";
import { matchUnlinkedContent } from "../src/lib/content/matcher";

// We use the directUrl for advisory locks because connection poolers (pgbouncer)
// in transaction mode do not support session-level advisory locks safely.
const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
});

const LOCK_ID = 424242;
const SYNC_INTERVAL_MS = 30 * 1000; // 30 seconds

async function acquireLock(): Promise<boolean> {
  const result: any[] = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${LOCK_ID})`;
  return result[0].pg_try_advisory_lock === true;
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_ID})`;
}

async function startWorker() {
  console.log("[Worker] Starting sync worker...");

  const gotLock = await acquireLock();
  if (!gotLock) {
    console.error("[Worker] Could not acquire advisory lock. Another worker is running.");
    process.exit(1);
  }

  console.log("[Worker] Acquired lock. Beginning sync loop.");

  try {
    while (true) {
      try {
        const state = await prisma.syncState.findUnique({ where: { key: "default" } });
        const needsBackfill = !state?.backfillCompleted;

        if (needsBackfill) {
          console.log("[Worker] Executing initial backfill...");
          await runSync("backfill");
        } else {
          console.log("[Worker] Executing incremental sync...");
          await runSync("incremental", 2);
        }

        // Match newly fetched rows to any waiting proxy content
        await matchUnlinkedContent();

        // update heartbeat
        await prisma.syncState.upsert({
          where: { key: "default" },
          create: { key: "default", workerHeartbeatAt: new Date() },
          update: { workerHeartbeatAt: new Date() },
        });

      } catch (err) {
        console.error("[Worker] Sync tick failed:", err);
      }

      console.log(`[Worker] Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, SYNC_INTERVAL_MS));
    }
  } finally {
    await releaseLock();
    await prisma.$disconnect();
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("[Worker] Shutting down...");
  await releaseLock();
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  console.log("[Worker] Shutting down...");
  await releaseLock();
  await prisma.$disconnect();
  process.exit(0);
});

startWorker().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
