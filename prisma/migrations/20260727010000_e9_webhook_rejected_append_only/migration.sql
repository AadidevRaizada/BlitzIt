-- E9 review fix - rejected webhook rows are append-only and cannot poison
-- the verified provider event dedupe keyspace.

DROP INDEX IF EXISTS "WebhookEvent_providerEventId_key";

CREATE INDEX "WebhookEvent_providerEventId_signatureVerified_outcome_idx"
  ON "WebhookEvent" ("providerEventId", "signatureVerified", "outcome");
