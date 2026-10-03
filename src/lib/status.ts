/**
 * Classifies raw Hostinger status strings into consistent internal statuses.
 * Expected values from Hostinger so far: "Delivered".
 * We map anything unknown to "other".
 */
export function classifyStatus(rawStatus: string): string {
  const s = rawStatus.toLowerCase().trim();
  if (s === "delivered") return "delivered";
  if (s.includes("fail") || s.includes("bounc") || s.includes("reject")) return "failed";
  if (s.includes("defer") || s.includes("queue") || s.includes("pend")) return "deferred";
  return "other";
}
