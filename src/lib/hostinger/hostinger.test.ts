import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HostingerClient } from "./client";
import { normalizeHostingerLog } from "./normalize";
import { computeFingerprint } from "../sync/fingerprint";
import type { HostingerOutboundLog } from "./schema";

const mockLog: HostingerOutboundLog = {
  account: "info@sagar.in",
  from: "no-reply@sagar.in",
  rcpt: "user@example.com",
  rcpts: "user@example.com",
  nrcpt: 1,
  client_ip: "192.168.1.1",
  timestamp: "2026-10-03T21:08:33Z",
  status: "Delivered",
  is_spam: false,
  relay_events: [
    {
      address_to: "user@example.com",
      relay: "smtp.example.com",
      delay: 1.5,
      dsn: "2.0.0",
      status: "Sent",
      response: "250 Ok",
      time: "2026-10-03T21:08:35Z",
    },
  ],
};

describe("Fingerprint", () => {
  it("computes identical hashes for same inputs despite whitespace or case", () => {
    const f1 = computeFingerprint(" INFO@sagar.in ", " No-Reply@sagar.in", "USER@example.com", "2026-10-03T21:08:33Z");
    const f2 = computeFingerprint("info@sagar.in", "no-reply@sagar.in", "user@example.com", "2026-10-03T21:08:33Z");
    expect(f1).toBe(f2);
    expect(f1).toHaveLength(64); // hex sha256
  });
});

describe("Normalize", () => {
  it("maps fields correctly", () => {
    const normalized = normalizeHostingerLog(mockLog, "OR123");
    expect(normalized.account).toBe("info@sagar.in");
    expect(normalized.sender).toBe("no-reply@sagar.in");
    expect(normalized.recipient).toBe("user@example.com");
    expect(normalized.recipientDomain).toBe("example.com");
    expect((normalized.timestamp as Date).toISOString()).toBe("2026-10-03T21:08:33.000Z");
    expect(normalized.isSpam).toBe(false);
    expect(normalized.clientIp).toBe("192.168.1.1");
    expect(normalized.relayEvents?.create).toHaveLength(1);
    
    // @ts-expect-error Prisma typing requires it
    const re = normalized.relayEvents.create[0];
    expect(re.delay).toBe(1.5);
    expect(re.position).toBe(0);
    expect(re.eventTime?.toISOString()).toBe("2026-10-03T21:08:35.000Z");
  });
});

describe("HostingerClient", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches and validates data", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [mockLog],
        meta: { current_page: 1, per_page: 100, total: 1 },
      }),
    });

    const client = new HostingerClient("test-token");
    const res = await client.fetchOutboundLogs("OR123", { from_date: "2026-10-01", to_date: "2026-10-02" });
    
    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  
  it("retries on 429", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [],
          meta: { current_page: 1, per_page: 100, total: 0 },
        }),
      });

    const client = new HostingerClient("test-token");
    const start = Date.now();
    const res = await client.fetchOutboundLogs("OR123", { from_date: "2026-10-01", to_date: "2026-10-02" });
    const elapsed = Date.now() - start;
    
    expect(res.data).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });
});
