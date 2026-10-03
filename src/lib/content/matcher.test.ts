import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { matchUnlinkedContent } from "./matcher";
import { PrismaClient } from "@prisma/client";

vi.mock("@prisma/client", () => {
  const mPrismaClient = {
    messageContent: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    emailMessage: {
      findMany: vi.fn(),
    },
  };
  return { PrismaClient: vi.fn(() => mPrismaClient) };
});

const prisma = new PrismaClient() as any;

describe("Matcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContent = {
    id: "content-1",
    sentAt: new Date("2026-10-04T10:00:00.000Z"),
    fromAddr: "app@example.com",
    toAddrs: ["user@example.com"],
    ccAddrs: [],
  };

  it("links if exact one candidate matches", async () => {
    prisma.messageContent.findMany.mockResolvedValue([mockContent]);
    
    prisma.emailMessage.findMany.mockResolvedValue([
      { id: "log-1", timestamp: new Date("2026-10-04T10:00:05.000Z") }
    ]);

    await matchUnlinkedContent();

    expect(prisma.messageContent.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: { emailMessageId: "log-1", matchConfidence: "exact" }
    });
  });

  it("links closest in time if multiple fuzzy candidates", async () => {
    prisma.messageContent.findMany.mockResolvedValue([mockContent]);
    
    prisma.emailMessage.findMany.mockResolvedValue([
      { id: "log-bad", timestamp: new Date("2026-10-04T10:01:50.000Z") },
      { id: "log-good", timestamp: new Date("2026-10-04T10:00:10.000Z") } // closer
    ]);

    await matchUnlinkedContent();

    expect(prisma.messageContent.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: { emailMessageId: "log-good", matchConfidence: "fuzzy" }
    });
  });

  it("does not link if no candidate", async () => {
    prisma.messageContent.findMany.mockResolvedValue([mockContent]);
    prisma.emailMessage.findMany.mockResolvedValue([]);

    await matchUnlinkedContent();

    expect(prisma.messageContent.update).not.toHaveBeenCalled();
  });
});
