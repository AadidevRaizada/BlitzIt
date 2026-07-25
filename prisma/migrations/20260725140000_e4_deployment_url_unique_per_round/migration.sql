-- E4 (Codex review) — enforce deployment-URL reuse detection (D19) in the DATABASE.
--
-- The application already refuses a deployment URL another competitor has used
-- in the same round, but that check is read-then-write: two competitors
-- submitting the same URL concurrently would both see no clash and both insert.
-- Only a constraint actually prevents it.
--
-- A disqualified entry deliberately keeps holding its URL: sharing a deployment
-- is precisely the behaviour this rule exists to catch.

-- CreateIndex
CREATE UNIQUE INDEX "Submission_roundId_deploymentUrl_key" ON "Submission"("roundId", "deploymentUrl");
