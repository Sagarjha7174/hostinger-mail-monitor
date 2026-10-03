/* eslint-disable no-console */
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";
import { encryptBuffer } from "../src/lib/content/crypto";
import { redactContent } from "../src/lib/content/redact";
import { getEnv } from "../src/lib/env";

const prisma = new PrismaClient();
const env = getEnv();

const PROXY_PORT = env.PROXY_PORT;
const UPSTREAM_HOST = env.SMTP_HOST;
const UPSTREAM_PORT = env.SMTP_PORT;
const UPSTREAM_USER = env.SMTP_USER;
const UPSTREAM_PASS = env.SMTP_PASS;

if (!UPSTREAM_USER || !UPSTREAM_PASS) {
  console.warn("[Proxy] Warning: SMTP_USER or SMTP_PASS not set in .env. Upstream relay will fail.");
}

const upstreamTransporter = nodemailer.createTransport({
  host: UPSTREAM_HOST,
  port: UPSTREAM_PORT,
  secure: UPSTREAM_PORT === 465,
  auth: { user: UPSTREAM_USER, pass: UPSTREAM_PASS },
});

const server = new SMTPServer({
  secure: false, // For local dev proxy, false is easier. In prod, enable TLS.
  authOptional: false,
  onAuth(auth, session, callback) {
    const validUser = env.PROXY_USERS.find(
      (u) => u.user === auth.username && u.pass === auth.password
    );
    if (validUser) {
      callback(null, { user: validUser });
    } else {
      callback(new Error("Invalid username or password"));
    }
  },
  async onData(stream, session, callback) {
    const buffers: Buffer[] = [];
    stream.on("data", (chunk) => buffers.push(chunk));
    stream.on("end", async () => {
      const rawEmail = Buffer.concat(buffers);
      const user = session.user as any;
      const proxyAccount = user?.user || "unknown";

      console.log(`[Proxy] Received email from ${proxyAccount}. Parsing...`);

      try {
        const parsed = await simpleParser(rawEmail);
        
        let bodyTextEnc: Buffer | null = null;
        let bodyHtmlEnc: Buffer | null = null;
        
        if (parsed.text) {
          const redacted = redactContent(parsed.text).substring(0, env.CONTENT_BODY_MAX_CHARS);
          bodyTextEnc = encryptBuffer(redacted);
        }
        
        if (parsed.html) {
          const redacted = redactContent(parsed.html).substring(0, env.CONTENT_BODY_MAX_CHARS);
          bodyHtmlEnc = encryptBuffer(redacted);
        }

        const attachments = parsed.attachments.map((a) => ({
          name: a.filename || "unnamed",
          size: a.size,
          contentType: a.contentType,
        }));

        const toAddrs = parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap(t => t.value.map(v => v.address || "")) : [];
        const ccAddrs = parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap(t => t.value.map(v => v.address || "")) : [];
        const fromAddr = parsed.from?.value[0]?.address || "unknown";

        // 1. Relay upstream first
        console.log(`[Proxy] Relaying upstream to ${UPSTREAM_HOST}...`);
        await upstreamTransporter.sendMail({
          envelope: {
            from: fromAddr,
            to: [...toAddrs, ...ccAddrs],
          },
          raw: rawEmail,
        });
        
        console.log(`[Proxy] Successfully relayed upstream.`);

        // 2. Store content in DB
        try {
          await prisma.messageContent.create({
            data: {
              proxyAccount,
              messageIdHeader: parsed.messageId || null,
              sentAt: parsed.date || new Date(),
              fromAddr,
              toAddrs,
              ccAddrs,
              subject: parsed.subject || "(No Subject)",
              bodyTextEnc,
              bodyHtmlEnc,
              attachments,
            },
          });
          console.log(`[Proxy] Stored email content securely in DB.`);
        } catch (dbErr) {
          console.error(`[Proxy] Failed to store content in DB, but email was relayed:`, dbErr);
        }

        callback();
      } catch (err) {
        console.error(`[Proxy] Error processing email:`, err);
        callback(err as Error);
      }
    });
  },
});

server.listen(PROXY_PORT, () => {
  console.log(`[Proxy] SMTP Proxy listening on port ${PROXY_PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
