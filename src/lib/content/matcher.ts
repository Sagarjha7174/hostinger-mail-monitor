import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function matchUnlinkedContent() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find all unlinked MessageContent created in the last 24h
  const unlinkedContents = await prisma.messageContent.findMany({
    where: {
      emailMessageId: null,
      createdAt: { gte: cutoff },
    },
  });

  for (const content of unlinkedContents) {
    const timeWindowStart = new Date(content.sentAt.getTime() - 120 * 1000);
    const timeWindowEnd = new Date(content.sentAt.getTime() + 120 * 1000);
    const allRecipients = [...content.toAddrs, ...content.ccAddrs];

    // Candidate EmailMessages from Hostinger
    // We only want rows that are not yet linked.
    const candidates = await prisma.emailMessage.findMany({
      where: {
        sender: content.fromAddr,
        recipient: { in: allRecipients },
        timestamp: { gte: timeWindowStart, lte: timeWindowEnd },
        content: { is: null }, // Must not be linked to another MessageContent already
      },
    });

    if (candidates.length === 0) {
      continue;
    }

    let matchConfidence = "exact";
    let bestMatch = candidates[0];

    if (candidates.length > 1) {
      matchConfidence = "fuzzy";
      // Pick the closest in time
      let minDiff = Infinity;
      for (const cand of candidates) {
        const diff = Math.abs(cand.timestamp.getTime() - content.sentAt.getTime());
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = cand;
        }
      }
    }

    await prisma.messageContent.update({
      where: { id: content.id },
      data: {
        emailMessageId: bestMatch.id,
        matchConfidence,
      },
    });
  }
}
