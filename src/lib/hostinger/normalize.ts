import { HostingerOutboundLog } from "./schema";
import { computeFingerprint } from "../sync/fingerprint";
import { Prisma } from "@prisma/client";

/**
 * Extracts the domain from an email address (everything after @).
 * Returns empty string if invalid.
 */
function getDomain(email: string): string {
  const parts = email.split("@");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

/**
 * Normalizes a Hostinger API record into a Prisma EmailMessage create payload.
 * `projectLabel` and `mailAccountId` are omitted as they are assigned at insertion time
 * by the sync logic (which resolves project mapping and ensures account exists).
 */
export function normalizeHostingerLog(
  log: HostingerOutboundLog,
  _orderId: string
): Omit<Prisma.EmailMessageCreateInput, "projectLabel" | "mailAccount" | "mailAccountId"> {
  const fingerprint = computeFingerprint(log.account, log.from, log.rcpt, log.timestamp);
  
  const recipientDomain = getDomain(log.rcpt);

  const relayEvents = (log.relay_events || []).map((event: Record<string, unknown>, i: number) => {
    return {
      position: i,
      addressTo: event.address_to ?? null,
      relay: event.relay ?? null,
      delay: event.delay ?? null,
      dsn: event.dsn ?? null,
      status: event.status ?? null,
      response: event.response ?? null,
      eventTime: event.time ? new Date(event.time as string) : null,
    };
  });

  return {
    fingerprint,
    account: log.account,
    sender: log.from,
    recipient: log.rcpt,
    recipients: log.rcpts ?? null,
    recipientCount: log.nrcpt ?? null,
    recipientDomain,
    timestamp: new Date(log.timestamp),
    status: log.status,
    isSpam: log.is_spam ?? false,
    clientIp: log.client_ip ?? null,
    raw: log as Prisma.InputJsonValue, // Store original raw json
    relayEvents: {
      create: relayEvents,
    },
  };
}
