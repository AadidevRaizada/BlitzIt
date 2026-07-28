import 'server-only';
import type { JobName, JobProcessor } from '../queue';
import { noopProcessor } from './noop';
import { evaluateProcessor } from './evaluate';
import { tournamentTransitionProcessor } from './tournament-transition';
import { reconcileTournamentProcessor } from './reconcile-tournament';
import { seedTournamentProcessor } from './seed-tournament';
import { advanceBracketProcessor } from './advance-bracket';
import { sendEmailProcessor } from './send-email';

/**
 * Processor registry. Maps a job name to its handler. Register new processors
 * here as later epics add them (payout, and anything E9 needs).
 */
export const processors: Partial<Record<JobName, JobProcessor>> = {
  noop: noopProcessor,
  evaluate: evaluateProcessor,
  tournamentTransition: tournamentTransitionProcessor,
  reconcileTournament: reconcileTournamentProcessor,
  seedTournament: seedTournamentProcessor,
  advanceBracket: advanceBracketProcessor,
  sendEmail: sendEmailProcessor,
};
