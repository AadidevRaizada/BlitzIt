-- E9.3 - payment webhook ledger and dedupe source of truth.
--
-- Additive table. Payment.webhookEventId is intentionally left in place for
-- backward-compatible detail display, but new dedupe checks use WebhookEvent.

CREATE TYPE "WebhookOutcome" AS ENUM ('APPLIED', 'DEDUPED', 'IGNORED', 'REJECTED');

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "paymentId" TEXT,
  "rawPayload" JSONB NOT NULL,
  "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
  "outcome" "WebhookOutcome" NOT NULL,
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookEvent_providerEventId_key"
  ON "WebhookEvent" ("providerEventId");

CREATE INDEX "WebhookEvent_paymentId_receivedAt_idx"
  ON "WebhookEvent" ("paymentId", "receivedAt");

CREATE INDEX "WebhookEvent_outcome_receivedAt_idx"
  ON "WebhookEvent" ("outcome", "receivedAt");

ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
