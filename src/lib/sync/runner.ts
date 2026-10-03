/* eslint-disable no-console */
import { PrismaClient, Prisma } from "@prisma/client";
import { HostingerClient } from "../hostinger/client";
import { normalizeHostingerLog } from "../hostinger/normalize";
import { classifyStatus } from "../status";
import { outboundLogSchema } from "../hostinger/schema";
import { getEnv } from "../env";
import { Address4, Address6 } from "ip-address";

const prisma = new PrismaClient();
const hostinger = new HostingerClient();

/** Determine project label from mappings */
async function resolveProjectLabel(
  logClientIp: string | null,
  logSender: string,
  mappings: { matchType: string; pattern: string; label: string }[]
): Promise<string | null> {
  // Try IP exact match
  if (logClientIp) {
    const ipMatch = mappings.find((m) => m.matchType === "ip" && m.pattern === logClientIp);
    if (ipMatch) return ipMatch.label;

    // Try CIDR match
    const cidrMappings = mappings.filter((m) => m.matchType === "cidr");
    const isV6 = logClientIp.includes(":");
    
    try {
      const targetIp = isV6 ? new Address6(logClientIp) : new Address4(logClientIp);
      
      for (const m of cidrMappings) {
        try {
          if (isV6 && m.pattern.includes(":")) {
            if (targetIp.isInSubnet(new Address6(m.pattern))) return m.label;
          } else if (!isV6 && m.pattern.includes(".")) {
            if (targetIp.isInSubnet(new Address4(m.pattern))) return m.label;
          }
        } catch {
          // ignore invalid cidr in db
        }
      }
    } catch {
      // ignore invalid log ip
    }
  }

  // Try sender exact match
  const senderMatch = mappings.find((m) => m.matchType === "sender" && m.pattern.toLowerCase() === logSender.toLowerCase());
  if (senderMatch) return senderMatch.label;

  return null;
}

export async function runSync(mode: "incremental" | "backfill", days: number = 2) {
  const accountEmail = getEnv().HOSTINGER_ACCOUNT_EMAIL ?? "unknown@example.com";
  const orderId = getEnv().HOSTINGER_ORDER_ID;
  
  if (!orderId) throw new Error("HOSTINGER_ORDER_ID not configured");

  // Ensure MailAccount exists
  let mailAccount = await prisma.mailAccount.findUnique({ where: { email: accountEmail } });
  if (!mailAccount) {
    mailAccount = await prisma.mailAccount.create({
      data: {
        email: accountEmail,
        domain: accountEmail.split("@").pop() || "unknown",
        hostingerOrderId: orderId,
      },
    });
  }

  const toDate = new Date();
  const fromDate = new Date();
  if (mode === "backfill") {
    fromDate.setDate(toDate.getDate() - 30); // 30 days backfill
  } else {
    fromDate.setDate(toDate.getDate() - days);
  }

  const syncRun = await prisma.syncRun.create({
    data: {
      mode,
      windowFrom: fromDate,
      windowTo: toDate,
      status: "running",
    },
  });

  const mappings = await prisma.projectMapping.findMany();

  let currentPage = 1;
  let hasMore = true;
  let recordsFetched = 0;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsInvalid = 0;
  let pagesFetched = 0;

  try {
    while (hasMore) {
      console.log(`[Sync] Fetching page ${currentPage}...`);
      const res = await hostinger.fetchOutboundLogs(orderId, {
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
        page: currentPage,
        per_page: 100,
      });

      pagesFetched++;
      
      const logs = res.data;
      if (logs.length === 0) {
        hasMore = false;
        break;
      }

      recordsFetched += logs.length;

      for (const rawLog of logs) {
        try {
          const parsedLog = outboundLogSchema.safeParse(rawLog);
          if (!parsedLog.success) {
            console.error("[Sync] Skipping invalid record:", parsedLog.error.message);
            recordsInvalid++;
            continue;
          }
          const normalized = normalizeHostingerLog(parsedLog.data, orderId);
          normalized.status = classifyStatus(normalized.status);
          
          const projectLabel = await resolveProjectLabel(normalized.clientIp ?? null, normalized.sender, mappings);

          // upsert
          const existing = await prisma.emailMessage.findUnique({
            where: { fingerprint: normalized.fingerprint },
            select: { id: true, status: true },
          });

          if (existing) {
            if (existing.status !== normalized.status) {
              await prisma.emailMessage.update({
                where: { id: existing.id },
                data: {
                  status: normalized.status,
                  raw: normalized.raw as Prisma.InputJsonValue,
                },
              });
              recordsUpdated++;
            }
          } else {
            await prisma.emailMessage.create({
              data: {
                ...normalized,
                projectLabel,
                mailAccountId: mailAccount.id,
              },
            });
            recordsInserted++;
          }
        } catch (err) {
          console.error("[Sync] Error processing record:", err);
          recordsInvalid++;
        }
      }

      if (res.meta.current_page * res.meta.per_page >= res.meta.total) {
        hasMore = false;
      } else {
        currentPage++;
      }
    }

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFetched,
        recordsInserted,
        recordsUpdated,
        recordsInvalid,
        pagesFetched,
      },
    });

    await prisma.syncState.upsert({
      where: { key: "default" },
      update: {
        lastSuccessfulAt: new Date(),
        ...(mode === "backfill" ? { backfillCompleted: true } : {}),
      },
      create: {
        key: "default",
        lastSuccessfulAt: new Date(),
        backfillCompleted: mode === "backfill",
      },
    });

    console.log(`[Sync] Finished ${mode} sync.`);
  } catch (err) {
    console.error("[Sync] Fatal error:", err);
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: (err as Error).message,
        recordsFetched,
        recordsInserted,
        recordsUpdated,
        recordsInvalid,
        pagesFetched,
      },
    });
    throw err;
  }
}
