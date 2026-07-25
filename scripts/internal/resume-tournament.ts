import '../load-env';
import { db } from '../../src/server/db';
import {
  getTournamentProgress,
  progressTournament,
} from '../../src/server/modules/tournament';

/**
 * Restart-recovery helper (E3 verification).
 *
 * A SEPARATE PROCESS that picks a tournament up mid-bracket knowing nothing
 * but its id, drives it as far as the persisted state allows, and prints the
 * result as JSON. `verify:tournament:e2e` spawns this to prove the engine keeps
 * no in-memory state: a cold process reaches the same place a warm one would.
 *
 * Not part of the app. Invoked as:
 *   tsx --conditions=react-server scripts/internal/resume-tournament.ts <id>
 */

async function main() {
  const tournamentId = process.argv[2];
  if (!tournamentId) {
    throw new Error('usage: resume-tournament.ts <tournamentId>');
  }

  const before = await getTournamentProgress(tournamentId);
  const result = await progressTournament(tournamentId, { runBy: 'restart' });
  const after = await getTournamentProgress(tournamentId);

  // Marker-delimited so the parent can find it regardless of surrounding logs.
  console.log(
    `__RESUME_RESULT__${JSON.stringify({
      before: { state: before.state },
      after: { state: after.state },
      decided: result.matchesDecided,
      transitions: result.transitions.map((t) => t.transition),
      completed: result.completed,
    })}__RESUME_RESULT__`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
