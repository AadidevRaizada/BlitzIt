-- E9 parts 6/7: minimal compliance persistence.
CREATE TABLE "TermsAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT,
  "userAgent" TEXT,
  "idempotencyKey" TEXT NOT NULL,

  CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TermsAcceptance_userId_version_key"
  ON "TermsAcceptance"("userId", "version");

CREATE UNIQUE INDEX "TermsAcceptance_idempotencyKey_key"
  ON "TermsAcceptance"("idempotencyKey");

CREATE INDEX "TermsAcceptance_userId_acceptedAt_idx"
  ON "TermsAcceptance"("userId", "acceptedAt" DESC);

ALTER TABLE "TermsAcceptance"
  ADD CONSTRAINT "TermsAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
