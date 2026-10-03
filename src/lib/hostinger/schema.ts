/**
 * Zod schemas for the Hostinger outbound mail logs API.
 * Shapes verified against the real API in Phase 0 — see docs/hostinger-schema.md.
 * Fields that were always present are required; anything not yet observed is optional.
 * Unknown extra keys are tolerated (loose objects) so an additive API change does not break sync.
 */
import { z } from "zod";

/** "8.1" | 8.1 → 8.1 ; unparsable → null */
const numericString = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const n = typeof v === "number" ? v : Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  });

/** RFC 3339 timestamp, e.g. 2026-10-03T21:08:33Z (always UTC "Z" in observed data). */
export const hostingerTimestamp = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid timestamp" });

export const relayEventSchema = z.looseObject({
  address_to: z.string().nullish(),
  relay: z.string().nullish(),
  delay: numericString.nullish(),
  dsn: z.string().nullish(),
  status: z.string().nullish(),
  response: z.string().nullish(),
  time: hostingerTimestamp.nullish(),
});
export type HostingerRelayEvent = z.infer<typeof relayEventSchema>;

export const outboundLogSchema = z.looseObject({
  account: z.string(),
  from: z.string(),
  rcpt: z.string(),
  rcpts: z.string().optional(),
  nrcpt: numericString.optional(),
  client_ip: z.string().nullish(),
  timestamp: hostingerTimestamp,
  status: z.string(),
  is_spam: z.boolean().optional().default(false),
  relay_events: z.array(relayEventSchema).optional().default([]),
});
export type HostingerOutboundLog = z.infer<typeof outboundLogSchema>;

export const paginationMetaSchema = z.looseObject({
  current_page: z.number().int(),
  per_page: z.number().int(),
  total: z.number().int(),
});
export type HostingerPaginationMeta = z.infer<typeof paginationMetaSchema>;

/**
 * Envelope. Records are validated individually by the client so one malformed
 * record is reported/skipped instead of failing the whole page.
 */
export const outboundLogsResponseSchema = z.looseObject({
  data: z.array(z.unknown()),
  meta: paginationMetaSchema,
});
export type HostingerOutboundLogsResponse = z.infer<typeof outboundLogsResponseSchema>;

export const mailOrderSchema = z.looseObject({
  id: z.string(),
  status: z.string().optional(),
  domain: z.looseObject({ id: z.string().optional(), name: z.string() }).optional(),
});
export const mailOrdersResponseSchema = z.looseObject({ data: z.array(mailOrderSchema) });
