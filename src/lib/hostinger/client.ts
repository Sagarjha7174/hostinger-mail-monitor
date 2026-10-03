import { getEnv } from "../env";
import { outboundLogsResponseSchema, HostingerOutboundLogsResponse } from "./schema";

export class HostingerClient {
  private baseUrl = "https://developers.hostinger.com";

  constructor(private token: string = getEnv().HOSTINGER_API_TOKEN) {}

  async fetchOutboundLogs(
    orderId: string,
    params: { from_date: string; to_date: string; page?: number; per_page?: number },
    retries = 3
  ): Promise<HostingerOutboundLogsResponse> {
    const url = new URL(`${this.baseUrl}/api/mail/v1/orders/${orderId}/logs/outbound`);
    url.searchParams.set("from_date", params.from_date);
    url.searchParams.set("to_date", params.to_date);
    
    if (params.page !== undefined) {
      url.searchParams.set("page", params.page.toString());
    }
    url.searchParams.set("per_page", (params.per_page ?? 100).toString());

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after");
            const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000 * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          if (response.status >= 500) {
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }
          throw new Error(`Hostinger API error: ${response.status} ${response.statusText} at ${url.toString()}`);
        }

        const data = await response.json();
        const parsed = outboundLogsResponseSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error(`Schema validation failed: ${parsed.error.message}`);
        }
        return parsed.data;
      } catch (err) {
        lastError = err as Error;
        if (err instanceof Error && err.message.includes("Schema validation")) {
          throw err; // Don't retry schema validation errors
        }
      }
    }
    
    throw new Error(`Failed to fetch Hostinger logs after ${retries} retries. Last error: ${lastError?.message}`);
  }
}
