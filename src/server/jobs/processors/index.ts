import 'server-only';
import type { JobName, JobProcessor } from '../queue';
import { noopProcessor } from './noop';

/**
 * Processor registry. Maps a job name to its handler. Register new processors
 * here as later epics add them (evaluate, advanceBracket, sendEmail, payout…).
 */
export const processors: Partial<Record<JobName, JobProcessor>> = {
  noop: noopProcessor,
  // evaluate: evaluateProcessor,   // Epic E2/E5
};
