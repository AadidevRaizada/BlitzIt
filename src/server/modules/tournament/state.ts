import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import type { Tournament } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  fromLifecycleState,
  nextState,
  toLifecycleState,
  type BracketShape,
  type LifecycleState,
  type TournamentTransition,
} from './lifecycle';
import {
  isBracketSize,
  MIN_BRACKET_SIZE,
  resolveTournamentConfig,
  type TournamentConfig,
} from './config';
import {
  closeRound,
  completeRound,
  createSimulationRounds,
  openRound,
} from './rounds';
import { computeSeeding } from './seeding';
import { generateBracket } from './bracket-generate';
import { assignFinalPlacements, getRoundCompletion } from './advancement';
import { countCompetitionEligibleRegistrations } from './registration';

/**
 * Persisted lifecycle transitions (E3.1).
 *
 * `lifecycle.ts` decides *whether* a transition is legal and *where* it leads.
 * This module is what makes it real: it locks the tournament row, records an
 * `OpsEvent` keyed for idempotency, runs the transition's side effects, writes
 * the new state, and audits the whole thing — all in one transaction.
 *
 * ## Idempotency
 *
 * Every transition has a deterministic key
 * (`optransition:{tournamentId}:{fromState}:{transition}`). Replaying a cron
 * tick, double-clicking an admin button, or retrying a crashed job all collapse
 * onto the same `OpsEvent` and return `applied: false` instead of running
 * twice. Combined with `SELECT … FOR UPDATE` on the tournament row, two racing
 * callers serialise rather than interleave.
 *
 * ## No in-memory state
 *
 * The lifecycle state is the pair of persisted columns (`status`,
 * `currentStage`). Kill the process at any point and the next call reads the
 * committed state and carries on. Nothing is cached between transitions.
 */

export interface TransitionOptions {
  /** Admin performing the transition; null for system/cron. */
  actorId?: string | null;
  /** Free-text origin recorded on the OpsEvent: `admin`, `cron`, `runner`… */
  runBy?: string;
  /** Required context for CANCEL; recorded either way. */
  reason?: string | null;
  /**
   * Skip the *business* guards (minimum registrations, round completion…).
   * Never skips the state machine itself — an illegal transition stays illegal.
   * This is the `forceTournamentTransition` ops escape hatch from the API spec.
   */
  force?: boolean;
  /** Override the derived idempotency key (e.g. a scheduled OpsEvent's key). */
  idempotencyKey?: string;
  now?: Date;
}

export interface TransitionResult {
  tournamentId: string;
  transition: TournamentTransition;
  from: LifecycleState;
  to: LifecycleState;
  /** False when this was an idempotent replay of an already-applied transition. */
  applied: boolean;
  opsEventId: string;
  detail: Record<string, unknown>;
}

/** Bracket shape read off the tournament, needed to resolve knockout targets. */
function bracketShape(tournament: Tournament): BracketShape | undefined {
  if (!isBracketSize(tournament.bracketSize)) return undefined;
  return {
    bracketSize: tournament.bracketSize,
    thirdPlaceEnabled: tournament.thirdPlaceEnabled,
  };
}

/**
 * The default idempotency key for a transition.
 *
 * It must stay STABLE across the transition itself: a replay reads the key
 * *after* the state has already moved, so keying on the from-state would make
 * every replay miss its own record and then fail as an illegal transition.
 *
 * Every transition occurs at most once in a tournament's life, so the
 * transition name alone identifies it — except `ADVANCE_STAGE`, which happens
 * once per knockout stage and is therefore qualified by the stage it left.
 */
export function transitionIdempotencyKey(
  tournamentId: string,
  from: LifecycleState,
  transition: TournamentTransition,
): string {
  if (transition === 'ADVANCE_STAGE') {
    return `optransition:${tournamentId}:ADVANCE_STAGE:${from}`;
  }
  return `optransition:${tournamentId}:${transition}`;
}

/**
 * Business guards. Separate from the state machine on purpose: the graph
 * answers "is this edge real?", these answer "is it sensible right now?".
 * Only these are skippable with `force`.
 */
async function assertGuards(
  tx: DbClient,
  tournament: Tournament,
  transition: TournamentTransition,
  config: TournamentConfig,
): Promise<void> {
  switch (transition) {
    case 'CLOSE_REGISTRATION': {
      // This guard STAYS, even though the reconciler now avoids ever tripping it
      // (D34: a schedule-driven close that would fail here becomes a CANCEL
      // instead). The two are not redundant — this is the backstop for every
      // OTHER way in, above all the admin's "Close registration" button, which
      // calls `applyTransition` with `force: false` and has nothing else
      // standing between it and a field too small to seed. Removing this let an
      // operator close a one-competitor tournament and march it to
      // GENERATE_BRACKET, which then refuses on MIN_BRACKET_SIZE mid-phase —
      // exactly the unrecoverable shape the START_SIMULATION comment below
      // describes. The schedule decides *whether to try*; this decides
      // *whether it is sensible*.
      const eligible = await countCompetitionEligibleRegistrations(
        tournament.id,
        tx,
      );
      if (eligible < config.minRegistrations) {
        throw new ConflictError(
          `only ${eligible} eligible registration(s); ${config.minRegistrations} are required to proceed`,
        );
      }
      return;
    }

    case 'START_SIMULATION': {
      const eligible = await countCompetitionEligibleRegistrations(
        tournament.id,
        tx,
      );
      if (eligible === 0) {
        throw new ConflictError('no registered competitors');
      }

      // EVERY simulation round needs a problem before the phase starts, not
      // just the one being opened now.
      //
      // This is the guard whose absence deadlocked `2026-w1`. Round 1 had a
      // problem and opened fine; rounds 2 and 3 did not, so when round 1 ended
      // `progressSimulation` could not open round 2 (`openRound` correctly
      // refuses a round with no problem). They stayed PENDING with a NULL
      // `deadlineAt` forever, and CLOSE_SIMULATION's "every round must have
      // finished" check treats PENDING-with-no-deadline as unfinished. The
      // phase could then neither advance nor close, and there is no admin
      // action that recovers it — `assignProblemToRound` cannot retrofit a
      // problem onto rounds that the phase has already moved past.
      //
      // Checking here turns that unrecoverable mid-phase deadlock into an
      // actionable error raised before anything goes live.
      //
      // Only rounds that already exist are checked. A tournament that closed
      // registration before rounds were created there has none yet; the effect
      // creates them and `openRound` still refuses round 1, which rolls the
      // whole transition back rather than half-starting the phase.
      const rounds = await tx.round.findMany({
        where: { tournamentId: tournament.id, type: 'SIMULATION' },
        select: { sequence: true, problemId: true },
        orderBy: { sequence: 'asc' },
      });
      const unassigned = rounds.filter((round) => round.problemId === null);
      if (unassigned.length > 0) {
        throw new ConflictError(
          `${unassigned.length} simulation round(s) have no problem assigned ` +
            `(round ${unassigned.map((r) => r.sequence).join(', ')}); ` +
            'assign a published problem to every simulation round before starting',
        );
      }
      return;
    }

    case 'CLOSE_SIMULATION': {
      // Every simulation round must actually have been PLAYED. Checking only
      // for outstanding evaluations is not enough: seconds after
      // START_SIMULATION nobody has submitted anything, so a submission-only
      // guard passes trivially and seeds the whole tournament off an empty
      // field. D13 sums three rounds — all three have to be over.
      const rounds = await tx.round.findMany({
        where: { tournamentId: tournament.id, type: 'SIMULATION' },
        select: { id: true, sequence: true, status: true, deadlineAt: true },
        orderBy: { sequence: 'asc' },
      });

      if (rounds.length === 0) {
        throw new ConflictError('the simulation phase has no rounds');
      }

      const now = new Date();
      const unfinished = rounds.filter(
        (round) =>
          round.status !== 'COMPLETED' &&
          !(
            round.status === 'JUDGING' ||
            (round.deadlineAt !== null && round.deadlineAt <= now)
          ),
      );
      if (unfinished.length > 0) {
        throw new ConflictError(
          `${unfinished.length} simulation round(s) have not finished ` +
            `(round ${unfinished.map((r) => r.sequence).join(', ')}); ` +
            'let each window close before seeding',
        );
      }

      // Seeding sums scored evaluations, so every submission must also have
      // reached a terminal state. Closing while the queue is draining would
      // silently seed on a partial field.
      const pending = await tx.submission.count({
        where: {
          tournamentId: tournament.id,
          round: { type: 'SIMULATION' },
          status: { in: ['RECEIVED', 'QUEUED', 'JUDGING'] },
        },
      });
      if (pending > 0) {
        throw new ConflictError(
          `${pending} simulation submission(s) are still being evaluated`,
        );
      }
      return;
    }

    case 'GENERATE_BRACKET': {
      if (!tournament.seededAt) {
        throw new ConflictError('the tournament has not been seeded yet');
      }
      // The floor is the same MIN_BRACKET_SIZE seeding enforces, not 2. Those
      // disagreed: seeding refused a field below 8, but this guard would have
      // waved through a hand-edited ranking of 3 and produced a draw that is
      // mostly byes. The two are now the same number from the same constant.
      const qualified = await tx.ranking.count({
        where: { tournamentId: tournament.id, qualified: true },
      });
      if (qualified < MIN_BRACKET_SIZE) {
        throw new ConflictError(
          `only ${qualified} competitor(s) qualified; a bracket needs at least ` +
            `${MIN_BRACKET_SIZE} (D6). Byes fill unused slots, but they cannot ` +
            'substitute for competitors.',
        );
      }
      return;
    }

    case 'START_KNOCKOUT': {
      const matches = await tx.match.count({
        where: { tournamentId: tournament.id },
      });
      if (matches === 0) {
        throw new ConflictError('no bracket has been generated');
      }
      return;
    }

    case 'ADVANCE_STAGE':
    case 'COMPLETE': {
      if (!tournament.currentStage) {
        throw new ConflictError('tournament is LIVE without a current stage');
      }
      const completion = await getRoundCompletion(
        tournament.id,
        tournament.currentStage,
        tx,
      );
      if (!completion.complete) {
        throw new ConflictError(
          `${tournament.currentStage} is not finished: ${completion.decided}/${completion.total} matches decided` +
            (completion.tied > 0
              ? ` (${completion.tied} awaiting a sudden-death challenge)`
              : ''),
        );
      }
      return;
    }

    default:
      return;
  }
}

/** Per-transition side effects. Runs inside the same transaction as the state write. */
async function applySideEffects(
  tx: DbClient,
  tournament: Tournament,
  transition: TournamentTransition,
  to: LifecycleState,
  config: TournamentConfig,
  options: TransitionOptions,
  now: Date,
): Promise<{
  data: Prisma.TournamentUpdateInput;
  detail: Record<string, unknown>;
}> {
  switch (transition) {
    case 'PUBLISH':
      return { data: {}, detail: {} };

    case 'OPEN_REGISTRATION':
      return {
        data: { registrationOpensAt: tournament.registrationOpensAt ?? now },
        detail: {},
      };

    case 'CLOSE_REGISTRATION': {
      const eligible = await countCompetitionEligibleRegistrations(
        tournament.id,
        tx,
      );

      // Create the simulation rounds here, PENDING, rather than at
      // START_SIMULATION. Creating and opening round 1 in one transaction left
      // no instant at which a problem could be attached to it: before the
      // transition the round did not exist, and after it `assignProblemToRound`
      // refuses anything that is no longer PENDING. That is how a round can end
      // up OPEN with a live countdown and no statement to show.
      //
      // This mirrors the knockout split that already works — GENERATE_BRACKET
      // creates the rounds, START_KNOCKOUT opens one — and the upsert on
      // (tournamentId, stage, sequence) keeps START_SIMULATION's own call a
      // no-op, so re-running either transition is still harmless.
      const rounds = await createSimulationRounds(tx, tournament.id, config);

      return {
        data: {
          registrationClosesAt: now,
          // Registration is closing, so the seat-reservation counter becomes
          // the frozen competitive field count.
          participantCount: eligible,
        },
        detail: {
          eligibleRegistrations: eligible,
          simulationRoundsCreated: rounds.length,
        },
      };
    }

    case 'START_SIMULATION': {
      // Idempotent: CLOSE_REGISTRATION already created these. Kept so a
      // tournament that closed registration before this change still starts.
      const rounds = await createSimulationRounds(tx, tournament.id, config);
      const first = rounds[0];
      // Refuses when no problem is assigned, rolling back the whole transition.
      if (first) await openRound(tx, first.id, now);
      return {
        data: { simulationOpensAt: tournament.simulationOpensAt ?? now },
        detail: { simulationRounds: rounds.length, openedRoundId: first?.id },
      };
    }

    case 'CLOSE_SIMULATION': {
      const rounds = await tx.round.findMany({
        where: { tournamentId: tournament.id, type: 'SIMULATION' },
        select: { id: true },
      });
      for (const round of rounds) {
        await closeRound(tx, round.id, now);
        await completeRound(tx, round.id);
      }

      // Seeding is a pure aggregation over evaluations that already exist. It
      // never evaluates anything — that boundary is the whole point of running
      // it here rather than inside bracket generation.
      // Fall through to the CONFIGURED size when the row has none. Passing the
      // bare column would make `TOURNAMENT_BRACKET_SIZE` silently inert: a
      // deployment pinned to 64 would still auto-size to 16 for a field of 20.
      const seeding = await computeSeeding(
        tournament.id,
        { bracketSize: tournament.bracketSize ?? config.bracketSize },
        tx,
      );

      return {
        data: { simulationClosesAt: now },
        detail: {
          eligible: seeding.eligibleCount,
          qualified: seeding.qualifiedCount,
          bracketSize: seeding.bracketSize,
        },
      };
    }

    case 'GENERATE_BRACKET': {
      const result = await generateBracket(tx, tournament.id, config);
      return { data: {}, detail: { ...result } };
    }

    case 'START_KNOCKOUT': {
      const { currentStage } = fromLifecycleState(to);
      if (!currentStage) {
        throw new ConflictError('START_KNOCKOUT resolved to no stage');
      }
      const round = await tx.round.findFirst({
        where: { tournamentId: tournament.id, stage: currentStage },
        select: { id: true },
      });
      if (!round) {
        throw new ConflictError(`no ${currentStage} round exists`);
      }
      await openRound(tx, round.id, now);
      return {
        data: { liveStartsAt: tournament.liveStartsAt ?? now },
        detail: { stage: currentStage, roundId: round.id },
      };
    }

    case 'ADVANCE_STAGE': {
      const previousStage = tournament.currentStage;
      const { currentStage } = fromLifecycleState(to);
      if (!previousStage || !currentStage) {
        throw new ConflictError('ADVANCE_STAGE is missing a stage');
      }

      const previous = await tx.round.findFirst({
        where: { tournamentId: tournament.id, stage: previousStage },
        select: { id: true },
      });
      if (previous) await completeRound(tx, previous.id);

      const next = await tx.round.findFirst({
        where: { tournamentId: tournament.id, stage: currentStage },
        select: { id: true },
      });
      if (!next) throw new ConflictError(`no ${currentStage} round exists`);
      await openRound(tx, next.id, now);

      return {
        data: {},
        detail: { from: previousStage, to: currentStage, roundId: next.id },
      };
    }

    case 'COMPLETE': {
      if (tournament.currentStage) {
        const round = await tx.round.findFirst({
          where: {
            tournamentId: tournament.id,
            stage: tournament.currentStage,
          },
          select: { id: true },
        });
        if (round) await completeRound(tx, round.id);
      }
      const placements = await assignFinalPlacements(tx, tournament.id);
      return {
        data: { completedAt: now },
        detail: { ...placements },
      };
    }

    case 'CANCEL':
      return {
        data: { cancelledAt: now, cancellationReason: options.reason ?? null },
        detail: { reason: options.reason ?? null },
      };

    default:
      return { data: {}, detail: {} };
  }
}

/**
 * Apply a lifecycle transition. The single entry point for changing a
 * tournament's state — nothing else writes `status` or `currentStage`.
 */
export async function applyTransition(
  tournamentId: string,
  transition: TournamentTransition,
  options: TransitionOptions = {},
): Promise<TransitionResult> {
  const now = options.now ?? new Date();

  return db.$transaction(
    async (tx) => {
      // Serialise concurrent transitions on this tournament. Without the lock,
      // two callers could both read DRAFT and both try to publish.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Tournament" WHERE "id" = ${tournamentId} FOR UPDATE`,
      );

      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
      });
      if (!tournament) {
        throw new NotFoundError(`tournament ${tournamentId} not found`);
      }

      const from = toLifecycleState(tournament.status, tournament.currentStage);
      const key =
        options.idempotencyKey ??
        transitionIdempotencyKey(tournamentId, from, transition);

      const prior = await tx.opsEvent.findUnique({
        where: { idempotencyKey: key },
      });
      if (prior?.status === 'DONE') {
        logger.info(
          { tournamentId, transition, key },
          'transition already applied; returning the recorded result',
        );
        return {
          tournamentId,
          transition,
          from,
          to: from,
          applied: false,
          opsEventId: prior.id,
          detail: (prior.result as Record<string, unknown> | null) ?? {},
        };
      }

      // Throws InvalidTransitionError for an illegal edge — the state machine
      // is NOT skippable, even with `force`.
      const to = nextState(from, transition, bracketShape(tournament));

      const config = resolveTournamentConfig(tournament);
      if (!options.force) {
        await assertGuards(tx, tournament, transition, config);
      }

      const opsEvent = await tx.opsEvent.upsert({
        where: { idempotencyKey: key },
        update: {
          status: 'RUNNING',
          startedAt: now,
          error: null,
          runBy: options.runBy ?? (options.actorId ? 'admin' : 'system'),
        },
        create: {
          tournamentId,
          type: transition,
          scheduledFor: now,
          status: 'RUNNING',
          idempotencyKey: key,
          runBy: options.runBy ?? (options.actorId ? 'admin' : 'system'),
          startedAt: now,
          payload: {
            from,
            to,
            force: options.force ?? false,
            reason: options.reason ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      const { data, detail } = await applySideEffects(
        tx,
        tournament,
        transition,
        to,
        config,
        options,
        now,
      );

      const target = fromLifecycleState(to);
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          ...data,
          status: target.status,
          currentStage: target.currentStage,
        },
      });

      await tx.opsEvent.update({
        where: { id: opsEvent.id },
        data: {
          status: 'DONE',
          completedAt: new Date(),
          result: { from, to, ...detail } as Prisma.InputJsonValue,
        },
      });

      await recordAudit(
        {
          actorId: options.actorId ?? null,
          action: `tournament.transition.${transition}`,
          entityType: 'Tournament',
          entityId: tournamentId,
          before: {
            status: tournament.status,
            currentStage: tournament.currentStage,
          },
          after: { status: target.status, currentStage: target.currentStage },
        },
        tx,
      );

      logger.info(
        { tournamentId, transition, from, to, force: options.force ?? false },
        'tournament transition applied',
      );

      return {
        tournamentId,
        transition,
        from,
        to,
        applied: true,
        opsEventId: opsEvent.id,
        detail,
      };
    },
    // Generating a 64-slot bracket writes ~130 rows; the default 5s ceiling is
    // too tight for that on a cold connection.
    { timeout: 60_000, maxWait: 15_000 },
  );
}

/** Current lifecycle state, read from the persisted columns. */
export async function getLifecycleState(
  tournamentId: string,
  client: DbClient = db,
): Promise<LifecycleState> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true, currentStage: true },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }
  return toLifecycleState(tournament.status, tournament.currentStage);
}
