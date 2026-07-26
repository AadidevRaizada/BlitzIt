-- E9 review fix: refund intent/outbox state and webhook first-delivery dedupe.

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING_REFUND';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_FAILED';

ALTER TABLE "Payment"
  ADD COLUMN "providerRefundId" TEXT,
  ADD COLUMN "refundIntentId" TEXT,
  ADD COLUMN "refundIntentAt" TIMESTAMP(3),
  ADD COLUMN "refundFailedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_providerRefundId_key" ON "Payment"("providerRefundId");
CREATE UNIQUE INDEX "Payment_refundIntentId_key" ON "Payment"("refundIntentId");

CREATE UNIQUE INDEX "WebhookEvent_verified_provider_event_once"
  ON "WebhookEvent"("providerEventId")
  WHERE "signatureVerified" = true
    AND "outcome" IN ('APPLIED', 'DEDUPED', 'IGNORED');
