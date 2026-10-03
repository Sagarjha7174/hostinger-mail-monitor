/**
 * Zod-validated environment. Parsed lazily (so `next build` can run without secrets) but
 * validated eagerly at process start: the web app via src/instrumentation.ts and the worker
 * in worker/index.ts. Any missing/invalid variable aborts startup with a clear message.
 *
 * Nothing here may ever be exposed through NEXT_PUBLIC_*.
 */
import { z } from "zod";

const cronExpr = z
  .string()
  .trim()
  .refine((s) => s.split(/\s+/).length >= 5 && s.split(/\s+/).length <= 6, "must be a 5/6-field cron expression");

const boolish = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url().refine((s) => s.startsWith("postgres"), "must be a postgres:// URL"),
  DIRECT_URL: z
    .string()
    .url()
    .refine((s) => s.startsWith("postgres"), "must be a postgres:// URL (Supabase session pooler or direct, port 5432)"),
  HOSTINGER_API_TOKEN: z.string().min(20, "looks too short to be a Hostinger API token"),
  HOSTINGER_ORDER_ID: z.string().min(1),
  HOSTINGER_ACCOUNT_EMAIL: z.string().email().optional(),
  HOSTINGER_API_BASE_URL: z.string().url().default("https://developers.hostinger.com"),
  SYNC_CRON: cronExpr.default("*/2 * * * *"),
  BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: z.string(),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  RETENTION_DAYS: z.coerce.number().int().min(1).optional().or(z.literal("").transform(() => undefined)),
  ENABLE_2FA: boolish,
  TOTP_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().optional(),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_SENT_FOLDER: z.string().optional(),
  CONTENT_ENCRYPTION_KEY: z.string().optional(),
  CONTENT_BODY_MAX_CHARS: z.coerce.number().int().default(2000),
  CONTENT_RETENTION_DAYS: z.coerce.number().int().default(30),
  CONTENT_SYNC_CRON: cronExpr.default("*/2 * * * *"),
  CONTENT_REDACT: boolish.default(true),
  
  SMTP_HOST: z.string().default("smtp.hostinger.com"),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  
  PROXY_PORT: z.coerce.number().int().default(2465),
  PROXY_USERS: z
    .string()
    .optional()
    .transform((str) => {
      if (!str) return [];
      try {
        const parsed = JSON.parse(str);
        return z.array(z.object({
          user: z.string(),
          pass: z.string(),
          project: z.string()
        })).parse(parsed);
      } catch {
        return [];
      }
    }),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const res = envSchema.safeParse(source);
  if (!res.success) {
    // Only report variable names and rule messages, never values.
    throw new EnvError(res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  if (res.data.ENABLE_2FA && !res.data.TOTP_SECRET) {
    throw new EnvError(["TOTP_SECRET: required when ENABLE_2FA=true (npm run totp-secret)"]);
  }
  return res.data;
}

export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** For process entrypoints: validate or exit(1) with a readable message. */
export function assertEnvOrExit(processName: string): Env {
  try {
    return getEnv();
  } catch (err) {
    console.error(`[${processName}] ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[${processName}] Copy .env.example to .env and fill in every value. Exiting.`);
    process.exit(1);
  }
}

/** test helper */
export function resetEnvCache(): void {
  cached = undefined;
}
