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
import { countActiveRegistrations } from './registration';

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
      const active = await countActiveRegistrations(tournament.id, tx);
      if (active < config.minRegistrations) {
        throw new ConflictError(
          `only ${active} registration(s); ${config.minRegistrations} are required to proceed`,
        );
      }
      return;
    }

    case 'START_SIMULATION': {
      const active = await countActiveRegistrations(tournament.id, tx);
      if (active === 0) {
        throw new ConflictError('no registered competitors');
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
      const qualified = await tx.ranking.count({
        where: { tournamentId: tournament.id, qualified: true },
      });
      if (qualified < 2) {
        throw new ConflictError(
          `only ${qualified} competitor(s) qualified; a bracket needs at least 2`,
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
      const active = await countActiveRegistrations(tournament.id, tx);
      return {
        data: {
          registrationClosesAt: now,
          // The counter drives capacity and (in E4) the prize pool; lock it to
          // reality at exactly the moment the field is frozen.
          participantCount: active,
        },
        detail: { registrations: active },
      };
    }

    case 'START_SIMULATION': {
      const rounds = await createSimulationRounds(tx, tournament.id, config);
      const first = rounds[0];
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
