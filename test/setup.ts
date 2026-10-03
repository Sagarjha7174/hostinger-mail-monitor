// Test env. Unit tests use fake values. Integration tests (test/integration/**) need a real
// Postgres: they use TEST_DATABASE_URL / TEST_DIRECT_URL if set, otherwise the Supabase URLs from
// .env with an isolated `hmm_test` schema, so production tables in `public` are never touched.
import { config } from "dotenv";

const fileEnv: Record<string, string> = {};
config({ processEnv: fileEnv, quiet: true });

function withSchema(url: string | undefined, schema: string): string | undefined {
  if (!url) return undefined;
  const u = new URL(url);
  u.searchParams.set("schema", schema);
  return u.toString();
}

const testDb = process.env.TEST_DATABASE_URL ?? withSchema(fileEnv.DATABASE_URL, "hmm_test");
const testDirect = process.env.TEST_DIRECT_URL ?? withSchema(fileEnv.DIRECT_URL, "hmm_test");

const defaults: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: testDb ?? "postgresql://unset:unset@localhost:5432/unset?schema=hmm_test",
  DIRECT_URL: testDirect ?? "postgresql://unset:unset@localhost:5432/unset?schema=hmm_test",
  HOSTINGER_API_TOKEN: "test-token-test-token-test-token",
  HOSTINGER_ORDER_ID: "ORtest",
  HOSTINGER_API_BASE_URL: "https://hostinger.test",
  SYNC_CRON: "*/2 * * * *",
  BACKFILL_DAYS: "30",
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$placeholder$placeholder",
  SESSION_SECRET: "test-session-secret-test-session-secret-0123",
  APP_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "fatal",
};
for (const [k, v] of Object.entries(defaults)) process.env[k] = v;
process.env.HMM_HAS_TEST_DB = testDb && testDirect ? "1" : "";
