import 'server-only';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import type { TournamentStatus } from '@/generated/prisma/client';
import {
  ARCHIVE_GRACE_MS,
  LIFECYCLE_BUCKET_MS,
} from '@/server/jobs/progress-sweep';
import {
  nextScheduledStep,
  reconciliationPath,
  targetStatusFor,
  type ScheduledTournament,
  type ScheduledStep,
} from './schedule.public';

/**
 * Why a tournament is where it is — for operators (D33).
 *
 * ## Why this exists
 *
 * The reconciler is allowed to stop short. A guard saying "only 3 registered,
 * 8 required" is a normal outcome, not a fault, and the sweep will simply try
 * again. But that refusal used to be recorded **only** in the `EvaluationJob`
 * table, so the admin page showed a tournament sitting motionless with no
 * explanation at all. The operator's entire diagnostic story was "nothing is
 * happening", and the only way to learn more was to open a psql session
 * against production.
 *
 * An administrator should never need SQL to understand why a tournament is
 * stuck. This assembles the whole answer — where it is, where the schedule says
 * it should be, what is being attempted, what refused, when it will be tried
 * again, and what to do about it.
 */

/**
 * What happened after an automatic cancellation (D34) — the honest version.
 *
 * The panel used to assert "notifications sent, refunds initiated" the moment a
 * tournament went CANCELLED, which was a claim about work that had not run yet
 * and might still fail. Everything here is read from the rows that record the
 * work actually happening, so a refund stuck at the gateway looks stuck.
 */
export interface CancellationDiagnostics {
  reason: string | null;
  cancelledAt: Date | null;
  /** When auto-archival becomes due. Null once archived. */
  archiveAt: Date | null;
  archivedAt: Date | null;
  /** State of the notify+refund job. NOT_STARTED = the sweep has yet to enqueue it. */
  cleanup: 'NOT_STARTED' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  /** Verbatim from the cleanup job's last failure. */
  cleanupError: string | null;
  /**
   * Entry-fee payments by disposition. Null for a free tournament, which has no
   * payments and therefore nothing to refund — distinct from "zero refunded".
   */
  refunds: {
    awaitingRefund: number;
    inFlight: number;
    refunded: number;
    failed: number;
  } | null;
}

export interface LifecycleDiagnostics {
  status: TournamentStatus;
  /** Where the schedule says it should be. Equal to `status` when converged. */
  targetStatus: TournamentStatus;
  /** True when the stored status has fallen behind the plan. */
  drifted: boolean;
  /** The transitions reconciliation will attempt, in order. */
  pendingPath: string[];
  /** The next milestone, due or not. */
  nextStep: ScheduledStep | null;
  /** Why the last reconciliation stopped, verbatim from the guard. */
  blockedReason: string | null;
  /** How many times it has been attempted since the last success. */
  attempts: number;
  /** Roughly how often it will be retried, in milliseconds. */
  retryEveryMs: number;
  /** What the operator should actually do. Null when nothing is wrong. */
  recommendation: string | null;
  /** Present only for a CANCELLED tournament (D34). */
  cancellation: CancellationDiagnostics | null;
}

/**
 * Turn a guard's message into an instruction.
 *
 * Deliberately matched on the message text rather than an error code: these
 * guards throw `ConflictError` with prose, and inventing a parallel code
 * taxonomy would mean two things to keep in step. The fallback is honest rather
 * than clever — an unrecognised reason is shown as-is with generic advice, not
 * disguised behind a guess.
 */
function recommend(reason: string | null, drifted: boolean): string | null {
  if (!reason) {
    return drifted
      ? 'The schedule is ahead of the tournament. Reconciliation runs on the next sweep — no action needed.'
      : null;
  }
  if (/eligible registration/i.test(reason)) {
    return (
      'Not enough competitors to close registration. Extend "Registration closes" ' +
      'in the schedule so more can enter, or lower the minimum in Settings. ' +
      'Registration must still be inside its window for anyone to join.'
    );
  }
  if (/no problem assigned|problem is assigned/i.test(reason)) {
    return (
      'Rounds have no problem attached, and a round cannot open without one. ' +
      'Assign a published problem to every round on the Timeline tab.'
    );
  }
  if (/evaluation|judging|still/i.test(reason)) {
    return 'Waiting for evaluations to finish. This clears itself; no action needed.';
  }
  if (/smallest supported bracket|at least/i.test(reason)) {
    return (
      'The field is below the minimum draw size. Extend registration to gather ' +
      'more competitors, or cancel the tournament.'
    );
  }
  return 'Resolve the condition above, or use the override buttons if you need to force progress.';
}

/** Read what the cancellation follow-up work has actually managed to do. */
async function cancellationDiagnostics(
  tournamentId: string,
  tournament: {
    cancelledAt: Date | null;
    cancellationReason: string | null;
    archivedAt: Date | null;
  },
  client: DbClient,
): Promise<CancellationDiagnostics> {
  const [job, payments] = await Promise.all([
    client.evaluationJob.findUnique({
      where: { idempotencyKey: `cancel-cleanup:${tournamentId}` },
      select: { status: true, lastError: true },
    }),
    client.payment.groupBy({
      by: ['status'],
      where: { tournamentId },
      _count: { _all: true },
    }),
  ]);

  const count = (status: string) =>
    payments.find((p) => p.status === status)?._count._all ?? 0;

  const cleanup: CancellationDiagnostics['cleanup'] = !job
    ? 'NOT_STARTED'
    : job.status === 'DONE'
      ? 'DONE'
      : job.status === 'FAILED'
        ? 'FAILED'
        : job.status === 'QUEUED'
          ? 'QUEUED'
          : 'RUNNING';

  return {
    reason: tournament.cancellationReason,
    cancelledAt: tournament.cancelledAt,
    archiveAt:
      tournament.cancelledAt && !tournament.archivedAt
        ? new Date(tournament.cancelledAt.getTime() + ARCHIVE_GRACE_MS)
        : null,
    archivedAt: tournament.archivedAt,
    cleanup,
    cleanupError: job && job.status !== 'DONE' ? (job.lastError ?? null) : null,
    refunds:
      payments.length === 0
        ? null
        : {
            awaitingRefund: count('PAID'),
            inFlight: count('PENDING_REFUND'),
            refunded: count('REFUNDED'),
            failed: count('REFUND_FAILED'),
          },
  };
}

export async function getLifecycleDiagnostics(
  tournamentId: string,
  client: DbClient = db,
  now: Date = new Date(),
): Promise<LifecycleDiagnostics | null> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      status: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      simulationOpensAt: true,
      simulationClosesAt: true,
      liveStartsAt: true,
      cancelledAt: true,
      cancellationReason: true,
      archivedAt: true,
    },
  });
  if (!tournament) return null;

  const scheduled: ScheduledTournament = tournament;
  const targetStatus = targetStatusFor(scheduled, now);
  const pendingPath = reconciliationPath(scheduled, now);

  // The most recent reconciliation attempt for this tournament. The key is
  // `reconcile:{tournamentId}:{bucket}`, so a prefix match finds them all
  // without needing to filter on JSON payload.
  const lastJob = await client.evaluationJob.findFirst({
    where: {
      name: 'reconcileTournament',
      idempotencyKey: { startsWith: `reconcile:${tournamentId}:` },
    },
    orderBy: { createdAt: 'desc' },
    select: { status: true, attempts: true, lastError: true },
  });

  // A DONE job carries no live complaint — its error, if any, is history.
  const blockedReason =
    lastJob && lastJob.status !== 'DONE' ? (lastJob.lastError ?? null) : null;

  return {
    status: tournament.status,
    targetStatus,
    drifted: pendingPath.length > 0,
    pendingPath,
    nextStep: nextScheduledStep(scheduled),
    blockedReason,
    attempts: lastJob?.attempts ?? 0,
    retryEveryMs: LIFECYCLE_BUCKET_MS,
    recommendation: recommend(blockedReason, pendingPath.length > 0),
    cancellation:
      tournament.status === 'CANCELLED'
        ? await cancellationDiagnostics(tournamentId, tournament, client)
        : null,
  };
}
