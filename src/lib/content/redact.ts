import { getEnv } from "../env";

/**
 * Redacts 4-8 digit numeric codes near sensitive keywords (otp, code, verify, etc.)
 * and redacts tokens in URLs.
 */
export function redactContent(text: string): string {
  if (!getEnv().CONTENT_REDACT) return text;
  
  let redacted = text;

  // Mask 4-8 digit codes near words like otp/code/verify
  const codeRegex = /\b(?:otp|code|verify|pin|token|password|secret)[\s:=-]+([0-9]{4,8})\b/gi;
  redacted = redacted.replace(codeRegex, (match, p1) => {
    return match.replace(p1, "[REDACTED_CODE]");
  });

  // Mask URL query tokens: token=, reset=, verify=, magic=, key=
  const tokenUrlRegex = /([?&](?:token|reset|verify|magic|key)=)([^&\s"']+)/gi;
  redacted = redacted.replace(tokenUrlRegex, "$1[REDACTED_TOKEN]");

  // Mask bare JWTs or long base64 strings if they look like tokens
  const jwtRegex = /\b(ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g;
  redacted = redacted.replace(jwtRegex, "[REDACTED_JWT]");

  return redacted;
}
