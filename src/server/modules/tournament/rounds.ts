import 'server-only';
import type { Round, RoundStage } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { NotFoundError, ConflictError } from '@/lib/errors';
import { resolveTournamentConfig, type TournamentConfig } from './config';

/**
 * Rounds and submission windows (E3).
 *
 * The Tournament module is the sole authority on *when* a competitor may
 * submit. It does not create, validate or store submissions — that is the
 * Submission module's job (E5). Keeping the window here and the submission
 * there is what stops the two from growing into one another: E5 asks
 * `isSubmissionWindowOpen`, it never re-derives the schedule.
 *
 * Every window is server-authoritative and persisted (`opensAt`/`deadlineAt`),
 * so a restart does not shift a deadline and no client clock is trusted.
 */

export interface SubmissionWindow {
  roundId: string;
  stage: RoundStage;
  opensAt: Date | null;
  deadlineAt: Date | null;
  status: Round['status'];
  isOpen: boolean;
  /** Seconds until the deadline; negative once it has passed. */
  secondsRemaining: number | null;
}

/**
 * A round accepts submissions only while it is OPEN *and* the wall clock sits
 * inside its persisted window. Both conditions matter: status alone would let
 * a crashed scheduler leave a round open forever, and timestamps alone would
 * accept submissions to a round nobody started.
 */
export function isSubmissionWindowOpen(
  round: Pick<Round, 'status' | 'opensAt' | 'deadlineAt'>,
  now: Date = new Date(),
): boolean {
  if (round.status !== 'OPEN') return false;
  if (!round.opensAt || now < round.opensAt) return false;
  if (!round.deadlineAt || now > round.deadlineAt) return false;
  return true;
}

export async function getSubmissionWindow(
  roundId: string,
  now: Date = new Date(),
  client: DbClient = db,
): Promise<SubmissionWindow> {
  const round = await client.round.findUnique({ where: { id: roundId } });
  if (!round) throw new NotFoundError(`round ${roundId} not found`);

  return {
    roundId: round.id,
    stage: round.stage,
    opensAt: round.opensAt,
    deadlineAt: round.deadlineAt,
    status: round.status,
    isOpen: isSubmissionWindowOpen(round, now),
    secondsRemaining: round.deadlineAt
      ? Math.round((round.deadlineAt.getTime() - now.getTime()) / 1000)
      : null,
  };
}

/**
 * Create the simulation rounds (D13: three of them, 30/20/10 by default).
 * Idempotent — re-running never duplicates a round, because the unique
 * (tournamentId, stage, sequence) key is the identity.
 */
export async function createSimulationRounds(
  client: DbClient,
  tournamentId: string,
  config: TournamentConfig,
): Promise<Round[]> {
  const rounds: Round[] = [];
  for (let index = 0; index < config.simulationRounds; index++) {
    const durationSeconds =
      config.simulationDurationsSeconds[index] ??
      config.simulationDurationsSeconds[
        config.simulationDurationsSeconds.length - 1
      ] ??
      config.stageDurationsSeconds.SIMULATION;

    rounds.push(
      await client.round.upsert({
        where: {
          tournamentId_stage_sequence: {
            tournamentId,
            stage: 'SIMULATION',
            sequence: index + 1,
          },
        },
        update: {},
        create: {
          tournamentId,
          type: 'SIMULATION',
          stage: 'SIMULATION',
          sequence: index + 1,
          durationSeconds,
          status: 'PENDING',
        },
      }),
    );
  }
  return rounds;
}

/**
 * Open a round's submission window. The deadline is derived from the round's
 * own `durationSeconds` and written down, never recomputed on read.
 */
export async function openRound(
  client: DbClient,
  roundId: string,
  now: Date = new Date(),
): Promise<Round> {
  const round = await client.round.findUnique({ where: { id: roundId } });
  if (!round) throw new NotFoundError(`round ${roundId} not found`);
  if (round.status === 'COMPLETED') {
    throw new ConflictError(`round ${roundId} is already completed`);
  }
  // Already open: keep the original window rather than silently extending it.
  if (round.status === 'OPEN' && round.opensAt && round.deadlineAt) {
    return round;
  }

  return client.round.update({
    where: { id: roundId },
    data: {
      status: 'OPEN',
      opensAt: now,
      deadlineAt: new Date(now.getTime() + round.durationSeconds * 1000),
    },
  });
}

/**
 * Close a round's window. Moves to JUDGING (evaluations still landing) rather
 * than COMPLETED — a round is only complete once its matches are decided.
 */
export async function closeRound(
  client: DbClient,
  roundId: string,
  now: Date = new Date(),
): Promise<Round> {
  const round = await client.round.findUnique({ where: { id: roundId } });
  if (!round) throw new NotFoundError(`round ${roundId} not found`);
  if (round.status === 'COMPLETED') return round;

  return client.round.update({
    where: { id: roundId },
    data: {
      status: 'JUDGING',
      // A round closed early still records when it actually stopped accepting
      // work, so "was this submission late?" stays answerable after the fact.
      deadlineAt:
        round.deadlineAt && round.deadlineAt < now ? round.deadlineAt : now,
    },
  });
}

/** Mark a round finished. Used once every match in it is decided. */
export async function completeRound(
  client: DbClient,
  roundId: string,
): Promise<Round> {
  return client.round.update({
    where: { id: roundId },
    data: { status: 'COMPLETED' },
  });
}

/** The round for a knockout stage, if the bracket created one. */
export async function getStageRound(
  tournamentId: string,
  stage: RoundStage,
  client: DbClient = db,
): Promise<Round | null> {
  return client.round.findFirst({
    where: { tournamentId, stage },
    orderBy: { sequence: 'asc' },
  });
}

/** All simulation rounds, in play order. */
export async function getSimulationRounds(
  tournamentId: string,
  client: DbClient = db,
): Promise<Round[]> {
  return client.round.findMany({
    where: { tournamentId, type: 'SIMULATION' },
    orderBy: { sequence: 'asc' },
  });
}

/**
 * Convenience for callers that only have a tournament id: resolve its config
 * without them needing to know which columns participate.
 */
export async function loadTournamentConfig(
  tournamentId: string,
  client: DbClient = db,
): Promise<TournamentConfig> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      bracketSize: true,
      thirdPlaceEnabled: true,
      minRegistrations: true,
      maxRegistrations: true,
      roundDurations: true,
    },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }
  return resolveTournamentConfig(tournament);
}
