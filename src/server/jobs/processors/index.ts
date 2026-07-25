import 'server-only';
import type { JobName, JobProcessor } from '../queue';
import { noopProcessor } from './noop';
import { evaluateProcessor } from './evaluate';
import { tournamentTransitionProcessor } from './tournament-transition';
import { seedTournamentProcessor } from './seed-tournament';
import { advanceBracketProcessor } from './advance-bracket';

/**
 * Processor registry. Maps a job name to its handler. Register new processors
 * here as later epics add them (sendEmail, payout…).
 */
export const processors: Partial<Record<JobName, JobProcessor>> = {
  noop: noopProcessor,
  evaluate: evaluateProcessor,
  tournamentTransition: tournamentTransitionProcessor,
  seedTournament: seedTournamentProcessor,
  advanceBracket: advanceBracketProcessor,
};
