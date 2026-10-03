-- CreateTable
CREATE TABLE "MessageContent" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "proxyAccount" TEXT,
    "messageIdHeader" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "fromAddr" TEXT NOT NULL,
    "toAddrs" TEXT[],
    "ccAddrs" TEXT[],
    "subject" TEXT NOT NULL,
    "bodyTextEnc" BYTEA,
    "bodyHtmlEnc" BYTEA,
    "attachments" JSONB NOT NULL,
    "matchConfidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageContent_emailMessageId_key" ON "MessageContent"("emailMessageId");

-- CreateIndex
CREATE INDEX "MessageContent_sentAt_idx" ON "MessageContent"("sentAt");

-- CreateIndex
CREATE INDEX "MessageContent_fromAddr_sentAt_idx" ON "MessageContent"("fromAddr", "sentAt");

-- AddForeignKey
ALTER TABLE "MessageContent" ADD CONSTRAINT "MessageContent_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
