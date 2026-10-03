import crypto from "crypto";

/**
 * Computes a deterministic sha256 fingerprint for a Hostinger outbound log.
 * Because Hostinger doesn't provide stable IDs for records, we use this to deduplicate.
 * 
 * Fields used (all lowercase): account, from, rcpt, timestamp
 */
export function computeFingerprint(
  account: string,
  from: string,
  rcpt: string,
  timestamp: string
): string {
  const parts = [
    account.trim().toLowerCase(),
    from.trim().toLowerCase(),
    rcpt.trim().toLowerCase(),
    timestamp.trim(),
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}
