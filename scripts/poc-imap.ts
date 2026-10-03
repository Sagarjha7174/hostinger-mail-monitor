import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as dotenv from "dotenv";

dotenv.config();

const IMAP_HOST = process.env.IMAP_HOST || "imap.hostinger.com";
const IMAP_PORT = parseInt(process.env.IMAP_PORT || "993", 10);
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;

if (!IMAP_USER || !IMAP_PASS) {
  console.error("Missing IMAP_USER or IMAP_PASS in .env. Please configure them first.");
  process.exit(1);
}

const client = new ImapFlow({
  host: IMAP_HOST,
  port: IMAP_PORT,
  secure: true,
  auth: { user: IMAP_USER, pass: IMAP_PASS },
  logger: false,
});

function mask(str: string) {
  if (!str) return str;
  const parts = str.split("@");
  if (parts.length === 2) {
    return `${parts[0].slice(0, 2)}***@${parts[1]}`;
  }
  return str.slice(0, 2) + "***";
}

async function run() {
  console.log(`[PoC] Connecting to ${IMAP_HOST}:${IMAP_PORT} as ${IMAP_USER}...`);
  await client.connect();
  console.log("[PoC] Connected successfully.");

  console.log("[PoC] Listing mailboxes...");
  const mailboxes = await client.list();
  
  let sentFolderPath = process.env.IMAP_SENT_FOLDER;
  
  for (const m of mailboxes) {
    if (m.specialUse === "\\Sent") {
      console.log(`[PoC] Found \\Sent special-use flag on: ${m.path}`);
      if (!sentFolderPath) sentFolderPath = m.path;
    }
  }

  if (!sentFolderPath) {
    sentFolderPath = "INBOX.Sent"; // fallback
    console.log(`[PoC] No \\Sent flag found, defaulting to ${sentFolderPath}`);
  }

  console.log(`[PoC] Selecting folder: ${sentFolderPath}...`);
  let lock;
  try {
    lock = await client.getMailboxLock(sentFolderPath);
  } catch (err) {
    console.error(`[PoC] Failed to open folder ${sentFolderPath}. Does it exist?`);
    await client.logout();
    process.exit(1);
  }

  console.log("[PoC] Fetching 5 newest messages...");
  
  // Fetch highest 5 UIDs
  const mailbox = client.mailbox;
  if (!mailbox || mailbox.exists === 0) {
    console.log("[PoC] Sent folder is empty!");
  } else {
    const seqFrom = Math.max(1, mailbox.exists - 4);
    const seqTo = mailbox.exists;
    console.log(`[PoC] Fetching sequences ${seqFrom}:${seqTo}`);

    for await (const msg of client.fetch(`${seqFrom}:${seqTo}`, { envelope: true, source: true })) {
      const parsed = await simpleParser(msg.source);
      console.log("-----------------------------------------");
      console.log(`UID: ${msg.uid}`);
      console.log(`Date: ${parsed.date}`);
      console.log(`From: ${mask(parsed.from?.value[0]?.address || "")}`);
      console.log(`To: ${mask(parsed.to?.value?.[0]?.address || "")}`);
      console.log(`Subject Length: ${parsed.subject?.length || 0}`);
      console.log(`Message-ID: ${parsed.messageId}`);
    }
  }

  lock.release();
  await client.logout();
  console.log("-----------------------------------------");
  console.log("PoC Complete. Please review the output above.");
  console.log("Do you see recent messages sent by your automated apps in this folder?");
  console.log("If NO: The Sent folder does not capture programmatic SMTP relays. We must switch to Route B.");
  console.log("If YES: Route A (IMAP syncing) is feasible.");
}

run().catch((err) => {
  console.error("[PoC] Fatal error:", err);
  process.exit(1);
});
