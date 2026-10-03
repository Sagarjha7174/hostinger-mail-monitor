-- CreateTable
CREATE TABLE "MailAccount" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "hostingerOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipients" TEXT,
    "recipientCount" INTEGER,
    "recipientDomain" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "isSpam" BOOLEAN NOT NULL DEFAULT false,
    "clientIp" TEXT,
    "projectLabel" TEXT,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mailAccountId" INTEGER,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayEvent" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "addressTo" TEXT,
    "relay" TEXT,
    "delay" DOUBLE PRECISION,
    "dsn" TEXT,
    "status" TEXT,
    "response" TEXT,
    "eventTime" TIMESTAMP(3),

    CONSTRAINT "RelayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "mode" TEXT NOT NULL,
    "windowFrom" TIMESTAMP(3),
    "windowTo" TIMESTAMP(3),
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "recordsInserted" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsInvalid" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMapping" (
    "id" SERIAL NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'ip',
    "pattern" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "key" TEXT NOT NULL,
    "lastSuccessfulAt" TIMESTAMP(3),
    "backfillCompleted" BOOLEAN NOT NULL DEFAULT false,
    "lastPrunedAt" TIMESTAMP(3),
    "workerHeartbeatAt" TIMESTAMP(3),

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_email_key" ON "MailAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_fingerprint_key" ON "EmailMessage"("fingerprint");

-- CreateIndex
CREATE INDEX "EmailMessage_timestamp_idx" ON "EmailMessage"("timestamp");

-- CreateIndex
CREATE INDEX "EmailMessage_status_timestamp_idx" ON "EmailMessage"("status", "timestamp");

-- CreateIndex
CREATE INDEX "EmailMessage_recipientDomain_idx" ON "EmailMessage"("recipientDomain");

-- CreateIndex
CREATE INDEX "EmailMessage_account_timestamp_idx" ON "EmailMessage"("account", "timestamp");

-- CreateIndex
CREATE INDEX "EmailMessage_clientIp_idx" ON "EmailMessage"("clientIp");

-- CreateIndex
CREATE INDEX "EmailMessage_sender_idx" ON "EmailMessage"("sender");

-- CreateIndex
CREATE INDEX "EmailMessage_projectLabel_idx" ON "EmailMessage"("projectLabel");

-- CreateIndex
CREATE INDEX "RelayEvent_emailMessageId_idx" ON "RelayEvent"("emailMessageId");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMapping_matchType_pattern_key" ON "ProjectMapping"("matchType", "pattern");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelayEvent" ADD CONSTRAINT "RelayEvent_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
