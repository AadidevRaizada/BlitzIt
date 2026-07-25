import 'server-only';
import type { JobName, JobProcessor } from '../queue';
import { noopProcessor } from './noop';
import { evaluateProcessor } from './evaluate';

/**
 * Processor registry. Maps a job name to its handler. Register new processors
 * here as later epics add them (advanceBracket, sendEmail, payout…).
 */
export const processors: Partial<Record<JobName, JobProcessor>> = {
  noop: noopProcessor,
  evaluate: evaluateProcessor,
};
