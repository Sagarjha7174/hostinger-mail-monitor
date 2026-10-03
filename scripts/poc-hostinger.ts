/**
 * Phase 0 proof of concept: verify the Hostinger outbound mail logs API
 * against the real account before anything is built on top of it.
 *
 *   npm run poc
 *
 * Only needs HOSTINGER_API_TOKEN, HOSTINGER_ORDER_ID and (optionally)
 * HOSTINGER_API_BASE_URL. The token is never printed. Email addresses are
 * masked in all console output and in docs/sample-response.json.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "..", "docs");

const PocEnv = z.object({
  HOSTINGER_API_TOKEN: z.string().min(1, "HOSTINGER_API_TOKEN is required"),
  HOSTINGER_ORDER_ID: z.string().optional().default(""),
  HOSTINGER_API_BASE_URL: z.string().url().default("https://developers.hostinger.com"),
});

const parsedEnv = PocEnv.safeParse(process.env);
if (!parsedEnv.success) {
  console.error("✗ Missing/invalid environment variables:");
  for (const issue of parsedEnv.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  console.error("Copy .env.example to .env and fill in the Hostinger values.");
  process.exit(1);
}
const env = parsedEnv.data;
const base = env.HOSTINGER_API_BASE_URL.replace(/\/+$/, "");
const path = `/api/mail/v1/orders/${encodeURIComponent(env.HOSTINGER_ORDER_ID)}/logs/outbound`;

// ---------------------------------------------------------------------------
// masking helpers
// ---------------------------------------------------------------------------
const EMAIL_RE = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function maskEmail(_m: string, local: string, domain: string): string {
  const parts = domain.split(".");
  const tld = parts.pop() ?? "";
  const host = parts.join(".");
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***.${tld}`;
}

function maskDeep(v: unknown): unknown {
  if (typeof v === "string") return v.replace(EMAIL_RE, maskEmail);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, maskDeep(val)]));
  }
  return v;
}

const maskToken = (s: string): string => s.split(env.HOSTINGER_API_TOKEN).join("<redacted>");

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
type Query = Record<string, string | number | undefined>;
interface CallResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function explain(status: number, body: unknown): string {
  const detail = maskToken(JSON.stringify(maskDeep(body))).slice(0, 400);
  switch (status) {
    case 401:
      return `401 Unauthorized - the API token was rejected (wrong, expired, or revoked). Body: ${detail}`;
    case 403:
      return `403 Forbidden - the token is valid but lacks access to this order/endpoint (permissions or plan). Body: ${detail}`;
    case 404:
      return `404 Not Found - wrong base URL, path, or HOSTINGER_ORDER_ID. Body: ${detail}`;
    case 422:
      return `422 Unprocessable - the API rejected a query parameter. Body: ${detail}`;
    case 429:
      return `429 Too Many Requests - rate limited. Body: ${detail}`;
    default:
      return `HTTP ${status}. Body: ${detail}`;
  }
}

async function call(query: Query = {}): Promise<CallResult> {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.HOSTINGER_API_TOKEN}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { url: url.pathname + url.search, status: res.status, headers, body };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// shape discovery
// ---------------------------------------------------------------------------
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

function extractRecords(body: unknown): { records: Rec[]; key: string | null } {
  if (Array.isArray(body)) return { records: body.filter(isRec), key: null };
  if (isRec(body)) {
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) return { records: v.filter(isRec), key: k };
      if (isRec(v)) {
        for (const [k2, v2] of Object.entries(v)) if (Array.isArray(v2)) return { records: v2.filter(isRec), key: `${k}.${k2}` };
      }
    }
  }
  return { records: [], key: null };
}

function describeShape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length ? [describeShape(v[0], depth + 1)] : ["<empty array>"];
  if (isRec(v)) {
    if (depth > 4) return "object";
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, describeShape(val, depth + 1)]));
  }
  return v === null ? "null" : typeof v;
}

function nonArrayTopLevel(body: unknown): Rec {
  if (!isRec(body)) return {};
  return Object.fromEntries(Object.entries(body).filter(([, v]) => !Array.isArray(v)));
}

const TS_HINT = /(time|date|_at$|^at$|timestamp)/i;

function collectValues(records: Rec[], key: string): unknown[] {
  return records.map((r) => r[key]).filter((v) => v !== undefined);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function listOrders(): Promise<void> {
  console.log("HOSTINGER_ORDER_ID is empty → discovering mail orders via GET /api/mail/v1/orders");
  const res = await fetch(`${base}/api/mail/v1/orders`, {
    headers: { Authorization: `Bearer ${env.HOSTINGER_API_TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (res.status !== 200) {
    console.error(`✗ ${explain(res.status, body)}`);
    process.exit(2);
  }
  const { records } = extractRecords(body);
  console.log(`  Found ${records.length} mail order(s). Shape: ${JSON.stringify(describeShape(maskDeep(body)))}`);
  for (const r of records) {
    const summary = Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v !== "object" || v === null));
    console.log("  -", JSON.stringify(maskDeep(summary)));
  }
  console.log("\nSet HOSTINGER_ORDER_ID in .env to the id of the order that owns your sending mailboxes, then re-run `npm run poc`.");
}

async function main(): Promise<void> {
  if (!env.HOSTINGER_ORDER_ID) return listOrders();
  const report: Rec = { generatedAt: new Date().toISOString(), baseUrl: base, path: path.replace(env.HOSTINGER_ORDER_ID, "{orderId}") };
  console.log(`→ GET ${base}${path.replace(env.HOSTINGER_ORDER_ID, "{orderId}")}?per_page=5`);

  const first = await call({ per_page: 5 });
  console.log(`  HTTP ${first.status}`);
  const rl = Object.fromEntries(Object.entries(first.headers).filter(([k]) => /ratelimit|retry-after|x-rate/i.test(k)));
  console.log("  Rate-limit headers:", Object.keys(rl).length ? rl : "(none)");
  report.firstCall = { status: first.status, rateLimitHeaders: rl, contentType: first.headers["content-type"] };

  if (first.status !== 200) {
    console.error(`✗ ${explain(first.status, first.body)}`);
    writeReport(report, first);
    process.exit(2);
  }

  const masked = maskDeep(first.body);
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(resolve(docsDir, "sample-response.json"), JSON.stringify(masked, null, 2) + "\n");
  console.log("  Wrote docs/sample-response.json (emails masked)");

  const { records, key } = extractRecords(first.body);
  const meta = nonArrayTopLevel(first.body);
  console.log(`  Records array at: ${key ?? "(top-level array)"}; count=${records.length}`);
  console.log("  Response shape:", JSON.stringify(describeShape(masked), null, 2));
  console.log("  Non-array top-level fields (pagination metadata?):", JSON.stringify(maskDeep(meta), null, 2));
  report.recordsKey = key;
  report.shape = describeShape(masked);
  report.paginationMeta = maskDeep(meta);

  if (!records.length) {
    console.warn("! No records returned. Send a test email from one of your apps and re-run to verify field shapes.");
  } else {
    console.log("  First record (masked):", JSON.stringify(maskDeep(records[0]), null, 2));
  }

  // larger sample for value analysis
  const big = await call({ per_page: 100 });
  const bigRecs = big.status === 200 ? extractRecords(big.body).records : [];
  report.perPage100 = { status: big.status, count: bigRecs.length, meta: maskDeep(nonArrayTopLevel(big.body)) };
  const sample = bigRecs.length ? bigRecs : records;

  const over = await call({ per_page: 101 });
  report.perPage101 = { status: over.status, count: extractRecords(over.body).records.length, error: over.status !== 200 ? maskDeep(over.body) : undefined };
  console.log(`  per_page=100 → HTTP ${big.status} (${bigRecs.length} recs); per_page=101 → HTTP ${over.status} (${extractRecords(over.body).records.length} recs)`);

  const page2 = await call({ per_page: 5, page: 2 });
  const p2 = extractRecords(page2.body).records;
  report.page2 = { status: page2.status, count: p2.length, meta: maskDeep(nonArrayTopLevel(page2.body)) };
  console.log(`  page=2 (per_page=5) → HTTP ${page2.status}, ${p2.length} recs`);

  // ---- field analysis
  const keys = new Map<string, Set<string>>();
  for (const r of sample) for (const [k, v] of Object.entries(r)) {
    const set = keys.get(k) ?? new Set<string>();
    set.add(Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
    keys.set(k, set);
  }
  const fieldTypes = Object.fromEntries([...keys].map(([k, s]) => [k, [...s].join("|")]));
  const presence = Object.fromEntries([...keys.keys()].map((k) => [k, `${sample.filter((r) => r[k] !== undefined && r[k] !== null).length}/${sample.length}`]));
  report.fieldTypes = fieldTypes;
  report.fieldPresence = presence;
  console.log("  Field types:", fieldTypes);
  console.log("  Field presence (non-null):", presence);

  const idCandidates = [...keys.keys()].filter((k) => /(^id$|_id$|uuid|message.?id|queue)/i.test(k));
  const idAnalysis = idCandidates.map((k) => {
    const vals = collectValues(sample, k).map(String);
    return { field: k, nonNull: vals.length, unique: new Set(vals).size, examples: vals.slice(0, 3).map((v) => (v.includes("@") ? String(maskDeep(v)) : v)) };
  });
  // cross-call stability: same records in two calls should keep the same id
  const again = await call({ per_page: 5 });
  const againRecs = extractRecords(again.body).records;
  const stability = idCandidates.map((k) => ({
    field: k,
    sameAcrossCalls: records.length > 0 && records.every((r, i) => againRecs[i] !== undefined && String(r[k]) === String(againRecs[i]?.[k])),
  }));
  report.idCandidates = idAnalysis;
  report.idStability = stability;
  console.log("  ID candidates:", idAnalysis, stability);

  const tsFields = [...keys.keys()].filter((k) => TS_HINT.test(k));
  const tsFormats = Object.fromEntries(tsFields.map((k) => [k, collectValues(sample, k).slice(0, 3)]));
  report.timestampSamples = tsFormats;
  console.log("  Timestamp samples:", tsFormats);

  const statusKey = [...keys.keys()].find((k) => /status/i.test(k) && !/relay/i.test(k));
  const statusValues = statusKey ? [...new Set(collectValues(sample, statusKey).map(String))] : [];
  report.statusField = statusKey ?? null;
  report.statusValuesSeen = statusValues;
  console.log(`  Status field: ${statusKey ?? "(none)"}; values seen: ${JSON.stringify(statusValues)}`);

  // every other low-cardinality string field: show distinct values (masked)
  const enums: Rec = {};
  for (const k of keys.keys()) {
    const vals = collectValues(sample, k).filter((v) => typeof v === "string" || typeof v === "boolean").map(String);
    const distinct = new Set(vals);
    if (vals.length && distinct.size <= 10 && !/@/.test([...distinct].join(""))) enums[k] = [...distinct];
  }
  report.lowCardinalityValues = enums;

  const ipKey = [...keys.keys()].find((k) => /ip/i.test(k) && !/(recipient|zip)/i.test(k));
  report.clientIpField = ipKey ?? null;
  report.clientIpDistinct = ipKey ? new Set(collectValues(sample, ipKey).map(String)).size : 0;
  console.log(`  client IP field: ${ipKey ?? "(none)"}; distinct values in sample: ${String(report.clientIpDistinct)}`);

  const relayKey = [...keys.keys()].find((k) => /relay|event|deliver/i.test(k) && fieldTypes[k]?.includes("array"));
  if (relayKey) {
    const evs = sample.flatMap((r) => (Array.isArray(r[relayKey]) ? (r[relayKey] as unknown[]) : [])).filter(isRec);
    const evKeys = new Map<string, Set<string>>();
    for (const e of evs) for (const [k, v] of Object.entries(e)) {
      const s = evKeys.get(k) ?? new Set<string>();
      s.add(v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
      evKeys.set(k, s);
    }
    const evStatus = [...new Set(evs.map((e) => e["status"]).filter((v) => v !== undefined).map(String))];
    const evCounts = sample.map((r) => (Array.isArray(r[relayKey]) ? (r[relayKey] as unknown[]).length : 0));
    report.relayEvents = {
      field: relayKey,
      total: evs.length,
      perRecord: { min: Math.min(...evCounts), max: Math.max(...evCounts) },
      fields: Object.fromEntries([...evKeys].map(([k, s]) => [k, [...s].join("|")])),
      statusValues: evStatus,
      example: maskDeep(evs[0]),
    };
    console.log("  Relay events:", JSON.stringify(report.relayEvents, null, 2));
  } else {
    report.relayEvents = null;
    console.log("  Relay events: (no array field found)");
  }

  // ---- filters
  const filters: Rec[] = [];
  const firstRec = sample[0];
  const pick = (re: RegExp): string | undefined => {
    if (!firstRec) return undefined;
    const k = Object.keys(firstRec).find((x) => re.test(x));
    const v = k ? firstRec[k] : undefined;
    return typeof v === "string" ? v : undefined;
  };
  const accountVal = pick(/^account$|account/i);
  const senderVal = pick(/^sender$|^from$/i);
  const recipientVal = pick(/^recipient$|^to$|^rcpt$/i);
  const recipientDomain = recipientVal?.split("@")[1];
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000);
  const today = now.toISOString().slice(0, 10);

  const unfilteredCount = bigRecs.length;
  const tests: { name: string; q: Query; check?: (r: Rec) => boolean }[] = [
    { name: "status=Failed", q: { status: "Failed", per_page: 100 }, check: (r) => statusKey !== undefined && String(r[statusKey]).toLowerCase().includes("fail") },
    { name: "status=Successful", q: { status: "Successful", per_page: 100 }, check: (r) => statusKey !== undefined && !String(r[statusKey]).toLowerCase().includes("fail") },
    { name: "recipient=<domain of first record>", q: { recipient: recipientDomain, per_page: 100 }, check: (r) => JSON.stringify(r).includes(`@${recipientDomain ?? "\u0000"}`) },
    { name: "recipient=<full address of first record>", q: { recipient: recipientVal, per_page: 100 }, check: (r) => JSON.stringify(r).includes(recipientVal ?? "\u0000") },
    { name: "sender=<sender of first record>", q: { sender: senderVal, per_page: 100 }, check: (r) => JSON.stringify(r).includes(senderVal ?? "\u0000") },
    { name: "account=<account of first record>", q: { account: accountVal, per_page: 100 }, check: (r) => JSON.stringify(r).includes(accountVal ?? "\u0000") },
    { name: "from_date/to_date (RFC3339, last 48h)", q: { from_date: twoDaysAgo.toISOString(), to_date: now.toISOString(), per_page: 100 } },
    { name: "from_date/to_date (YYYY-MM-DD)", q: { from_date: twoDaysAgo.toISOString().slice(0, 10), to_date: today, per_page: 100 } },
    { name: "date=today (YYYY-MM-DD)", q: { date: today, per_page: 100 } },
  ];
  for (const t of tests) {
    if (Object.values(t.q).some((v) => v === undefined)) {
      filters.push({ name: t.name, result: "skipped (no sample value)" });
      continue;
    }
    const r = await call(t.q);
    const recs = extractRecords(r.body).records;
    const allMatch = t.check ? recs.every(t.check) : undefined;
    const tsK = tsFields[0];
    const range = tsK && recs.length ? { newest: recs[0]?.[tsK], oldest: recs[recs.length - 1]?.[tsK] } : undefined;
    const verdict =
      r.status !== 200
        ? `rejected (HTTP ${r.status})`
        : t.check
          ? allMatch
            ? recs.length < unfilteredCount || recs.length === 0
              ? "works"
              : "accepted; all rows match (cannot prove filtering, sample too uniform)"
            : "accepted but IGNORED (non-matching rows returned)"
          : "accepted (inspect timestamp range)";
    filters.push({ name: t.name, http: r.status, count: recs.length, verdict, range, error: r.status !== 200 ? maskDeep(r.body) : undefined });
    console.log(`  filter ${t.name}: HTTP ${r.status}, ${recs.length} recs → ${verdict}${range ? ` ${JSON.stringify(range)}` : ""}`);
  }
  report.filters = filters;

  await fullScan(report);

  writeReport(report, first);
  console.log("\n✓ POC finished. Report: docs/poc-report.json");
}

function count(values: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[String(v)] = (out[String(v)] ?? 0) + 1;
  return out;
}

/** Walk every page inside a frozen window and profile the whole dataset. */
async function fullScan(report: Rec): Promise<void> {
  console.log("\n→ Full scan (per_page=100, to_date frozen at scan start)");
  const toDate = new Date().toISOString();
  const all: Rec[] = [];
  let total: unknown;
  let page = 1;
  for (; page <= 50; page++) {
    const r = await call({ per_page: 100, page, to_date: toDate, from_date: new Date(Date.now() - 40 * 86400_000).toISOString() });
    if (r.status !== 200) {
      console.log(`  page ${page}: HTTP ${r.status}`);
      break;
    }
    const recs = extractRecords(r.body).records;
    const meta = nonArrayTopLevel(r.body)["meta"];
    total = isRec(meta) ? meta["total"] : undefined;
    all.push(...recs);
    if (recs.length < 100) break;
  }
  const beyond = await call({ per_page: 100, page: page + 1, to_date: toDate });
  const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
  const events = all.flatMap((r) => (Array.isArray(r["relay_events"]) ? (r["relay_events"] as unknown[]) : [])).filter(isRec);
  const fp = (r: Rec): string => {
    const ev = Array.isArray(r["relay_events"]) ? (r["relay_events"] as unknown[]).filter(isRec) : [];
    return [str(r, "account"), str(r, "from"), str(r, "rcpt"), str(r, "timestamp"), ev[0] ? String(ev[0]["time"]) : ""].join("|");
  };
  const fps = count(all.map(fp));
  const collisions = Object.values(fps).filter((n) => n > 1).length;
  const fpNoRelay = count(all.map((r) => [str(r, "account"), str(r, "from"), str(r, "rcpt"), str(r, "timestamp")].join("|")));
  const sorted = all.every((r, i) => i === 0 || str(all[i - 1] as Rec, "timestamp") >= str(r, "timestamp"));
  const nonOk = all.filter((r) => str(r, "status") !== "Delivered").slice(0, 5);
  const tsFormats = count(all.map((r) => str(r, "timestamp").replace(/\d/g, "9")));
  const evTsFormats = count(events.map((e) => String(e["time"]).replace(/\d/g, "9")));
  const scan = {
    pagesFetched: page,
    recordsFetched: all.length,
    metaTotal: total,
    pageBeyondLast: { http: beyond.status, count: extractRecords(beyond.body).records.length },
    sortedDescByTimestamp: sorted,
    oldest: all.length ? str(all[all.length - 1] as Rec, "timestamp") : null,
    newest: all.length ? str(all[0] as Rec, "timestamp") : null,
    statusCounts: count(all.map((r) => r["status"])),
    isSpamCounts: count(all.map((r) => r["is_spam"])),
    nrcptCounts: count(all.map((r) => r["nrcpt"])),
    rcptEqualsRcpts: all.filter((r) => str(r, "rcpt") === str(r, "rcpts")).length,
    rcptsWithMultiple: all.filter((r) => /[,;\s]/.test(str(r, "rcpts").trim())).length,
    accountEqualsFrom: all.filter((r) => str(r, "account").toLowerCase() === str(r, "from").toLowerCase()).length,
    distinctAccounts: new Set(all.map((r) => str(r, "account"))).size,
    distinctClientIps: new Set(all.map((r) => str(r, "client_ip"))).size,
    relayEventsPerRecord: count(all.map((r) => (Array.isArray(r["relay_events"]) ? (r["relay_events"] as unknown[]).length : "missing"))),
    relayStatusCounts: count(events.map((e) => e["status"])),
    relayDsnCounts: count(events.map((e) => e["dsn"])),
    relayDelayNonNumeric: events.filter((e) => Number.isNaN(Number(e["delay"]))).map((e) => e["delay"]).slice(0, 5),
    timestampFormats: tsFormats,
    relayTimeFormats: evTsFormats,
    fingerprintCollisions_withRelayTime: collisions,
    fingerprintCollisions_withoutRelayTime: Object.values(fpNoRelay).filter((n) => n > 1).length,
    nonDeliveredExamples: maskDeep(nonOk),
  };
  report.fullScan = scan;
  console.log(JSON.stringify(maskDeep(scan), null, 2));
}

function writeReport(report: Rec, first: CallResult): void {
  mkdirSync(docsDir, { recursive: true });
  report.firstCallBodyIfError = first.status === 200 ? undefined : maskDeep(first.body);
  writeFileSync(resolve(docsDir, "poc-report.json"), maskToken(JSON.stringify(maskDeep(report), null, 2)) + "\n");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.name === "AbortError" ? "Request timed out after 15s" : err.message) : String(err);
  console.error(`✗ POC failed: ${maskToken(msg)}`);
  process.exit(1);
});
