# Hostinger outbound mail logs — verified schema

Verified against the real API on **2026-10-03 (UTC)** with `npm run poc` (`scripts/poc-hostinger.ts`).
Raw evidence: [`poc-report.json`](./poc-report.json), [`sample-response.json`](./sample-response.json) (emails masked).
Dataset at verification time: 289 records, 1 sending account, 2026-09-15 → 2026-10-03.

## Endpoint & auth — ✅ confirmed

| Item | Value |
|---|---|
| Base URL | `https://developers.hostinger.com` |
| Endpoint | `GET /api/mail/v1/orders/{orderId}/logs/outbound` |
| Auth | `Authorization: Bearer <token>` (token from hPanel → API) |
| Order discovery | `GET /api/mail/v1/orders` → `data[].id` (e.g. `OR98d6…`) |
| Rate limit | 90 req / 60 s per user. Headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `ratelimit: "api";r=88;t=60`, `ratelimit-policy: "api";q=90;w=60`. `Retry-After` on 429 (per docs, not observed). |
| Latency | ~1–3 s per request observed. |

## Response envelope — ✅ confirmed

```json
{ "data": [ <record>, ... ], "meta": { "current_page": 1, "per_page": 5, "total": 289 } }
```

- **No** `last_page`, `next_page_url` or `links`. Pages = `ceil(total / per_page)`.
- Requesting a page past the end returns **200 with `data: []`** (not 404).
- Sorted **descending by `timestamp`** (newest first) — confirmed over all 289 records.
- Because order is newest-first, new mail arriving mid-pagination shifts records between pages.
  The sync therefore **freezes `to_date` at run start** so the window is stable.

## Record — ✅ confirmed (all fields present & non-null in 289/289)

| Field | Type | Example / notes |
|---|---|---|
| `account` | string | Authenticated Hostinger mailbox (`i***@s***.in`). |
| `from` | string | Envelope/header sender. **Differs from `account`** in 165/289 records (`no-reply@` vs `info@`). |
| `rcpt` | string | Recipient address. |
| `rcpts` | string | Equal to `rcpt` in 289/289. Multi-recipient format **unconfirmed** (never seen). |
| `nrcpt` | **string** | `"1"` in all records (number serialized as string). |
| `client_ip` | string | IPv4 **or IPv6**. 86 distinct values in 289 records (see attribution caveat). |
| `timestamp` | string | `YYYY-MM-DDTHH:MM:SSZ` (RFC 3339, UTC, second precision) — 289/289. |
| `status` | string | Only `"Delivered"` observed. |
| `is_spam` | boolean | `true` in 10/289 (still `Delivered`). |
| `relay_events` | array | Exactly 1 event per record in 289/289. |

### `relay_events[]`

| Field | Type | Example / notes |
|---|---|---|
| `address_to` | string | Recipient. |
| `relay` | string | `smtp.mailchannels.net[35.166.226.169]:587` |
| `delay` | **string** | `"8.1"` (seconds, numeric string; parsed to float). |
| `dsn` | string | Only `"2.0.0"` observed. |
| `status` | string | Only `"Sent"` observed. |
| `response` | string | `250 2.0.0 Ok: queued as DF4807A0D88` — **untrusted text, never render as HTML**. |
| `time` | string | Same format as `timestamp`. |

## Stable unique ID — ❌ none

No `id`, `uuid`, `message_id` or `queue_id` field exists. The `queued as XXXX` token in
`relay_events[].response` is the *downstream relay's* queue ID and only exists after relaying, so it is
not usable as a primary key.

→ Dedupe uses a **fingerprint** — see `src/lib/sync/fingerprint.ts`:
`sha256(account | from | rcpt | timestamp)` (lower-cased addresses).
**Deviation from the original plan:** the first relay-event time is deliberately *excluded*, because relay
events are the part of a record most likely to change when a message moves from deferred → delivered/failed;
including it would turn a status update into a duplicate row. Over the 289 real records the 4-field key had
**0 collisions** (the 5-field variant also had 0). Residual risk: two messages from the same sender to the same
recipient within the same second would be merged.

## Filters

| Param | Result |
|---|---|
| `per_page` | Works. **101 was accepted** (returned 101) — the "max 100" assumption is wrong/unenforced. We still use 100. |
| `page` | Works (1-based). |
| `status=Failed` | Accepted, 0 rows (consistent with no failures in dataset). |
| `status=Successful` | Accepted, returns `Delivered` rows → **the filter vocabulary (`Successful`/`Failed`) differs from record values (`Delivered`)**. |
| `recipient=<domain>` | ✅ Works (90 rows). |
| `recipient=<full address>` | ✅ Works (1 row). |
| `sender=<address>` | Accepted; could not prove filtering (all sample rows matched). |
| `account=<address>` | Accepted; could not prove filtering (only 1 account exists). |
| `from_date`/`to_date` RFC 3339 | ✅ Works with **second precision** (48 h window returned exactly the expected range). Used by sync. |
| `from_date`/`to_date` `YYYY-MM-DD` | Accepted. |
| `date=YYYY-MM-DD` | ✅ Works, interpreted as a **UTC** day. |

## Differences vs. the original (second-hand) summary

1. Sender field is **`from`**, not `sender`; recipient is **`rcpt`** (+ `rcpts`, `nrcpt`), not `recipient`.
2. `nrcpt` and `relay_events[].delay` are **strings**, not numbers.
3. No stable record ID → fingerprint dedupe (see above).
4. `per_page` max of 100 is not enforced (101 accepted).
5. Pagination meta has no "next"/"last" fields — only `current_page`, `per_page`, `total`.
6. `client_ip` includes IPv6 and is **highly dynamic** (mobile carrier + AWS ranges; 86 distinct IPs for one
   account in 18 days). IP→project attribution will be weak; the app therefore also supports CIDR and
   sender-address mappings (see README). Treat any label as an inference.
7. Observed retention window: oldest record 2026-09-15 while order dates from 2026-02 — i.e. **~18 days of
   history was available**, less than the assumed 30. Backfill still requests 30 days; the archive must sync
   frequently.

## Unconfirmed (modeled as optional / open strings)

- Non-`Delivered` record status values (failed, deferred, bounced, queued, …) — none seen. The status
  classifier (`src/lib/status.ts`) maps `Delivered` → delivered and uses keyword heuristics for unseen values,
  defaulting to **other**. Revisit once a failure occurs.
- Non-`Sent` relay statuses and non-`2.0.0` DSNs.
- Records with 0 or >1 relay events, multi-recipient `rcpts` format.
- Whether a record's `status`/`relay_events` mutate in place over time (assumed possible; sync updates rows).
- `Retry-After` format on 429.
