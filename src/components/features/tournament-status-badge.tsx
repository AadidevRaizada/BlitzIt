import type { RoundStage, TournamentStatus } from '@/generated/prisma/client';
import { Badge, type BadgeTone } from '@/components/ui/badge';

/**
 * Lifecycle pill for a tournament.
 *
 * Shows the *pair* (`status`, `currentStage`) the way E3 models it, so a LIVE
 * tournament reads "Live · QF" rather than an undifferentiated "Live" — which
 * is the whole reason the stage is a separate column.
 */
const TONE: Record<TournamentStatus, BadgeTone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'outline',
  REGISTRATION_OPEN: 'brand',
  REGISTRATION_CLOSED: 'info',
  SIMULATION: 'brand',
  SEEDING: 'info',
  BRACKET_GENERATED: 'info',
  LIVE: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

const LABEL: Record<TournamentStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  REGISTRATION_OPEN: 'Registration open',
  REGISTRATION_CLOSED: 'Registration closed',
  SIMULATION: 'Simulation',
  SEEDING: 'Seeding',
  BRACKET_GENERATED: 'Bracket ready',
  LIVE: 'Live',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function TournamentStatusBadge({
  status,
  stage,
}: {
  status: TournamentStatus;
  stage?: RoundStage | null;
}) {
  const label =
    status === 'LIVE' && stage
      ? `${LABEL[status]} · ${stage.replace('_', ' ')}`
      : LABEL[status];

  return <Badge tone={TONE[status]}>{label}</Badge>;
}

/** Human label for a lifecycle transition, used on the control buttons. */
export const TRANSITION_LABEL: Record<string, string> = {
  PUBLISH: 'Publish',
  OPEN_REGISTRATION: 'Open registration',
  CLOSE_REGISTRATION: 'Close registration',
  START_SIMULATION: 'Start simulation',
  CLOSE_SIMULATION: 'Close simulation & seed',
  GENERATE_BRACKET: 'Generate bracket',
  START_KNOCKOUT: 'Start knockout',
  ADVANCE_STAGE: 'Advance stage',
  COMPLETE: 'Complete tournament',
  CANCEL: 'Cancel tournament',
};
