-- D34 — Auto-cancellation of tournaments with insufficient registrations.
--
-- Additive only. Adds a new notification type for tournament cancellations.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TOURNAMENT_CANCELLED';
