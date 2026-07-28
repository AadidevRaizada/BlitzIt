import 'server-only';
import type {
  MyTournamentState,
  PublicTournamentCard,
} from '@/server/modules/tournament';

export type NextActionKind =
  | 'SIGN_IN'
  | 'COMPLETE_PROFILE'
  | 'ACCEPT_TERMS'
  | 'PAY_ENTRY_FEE'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'REGISTERED_WAITING'
  | 'SUBMIT_NOW'
  | 'AWAITING_EVALUATION'
  | 'VIEW_EVALUATION'
  | 'MATCH_LIVE'
  | 'BYE_AWARDED'
  | 'ELIMINATED'
  | 'TOURNAMENT_FINISHED'
  | 'NOTHING_NOW';

export interface NextAction {
  kind: NextActionKind;
  title: string;
  body: string;
  label: string;
  href: string;
  priority: 'blocked' | 'primary' | 'waiting' | 'done';
}

export interface MissionControlState {
  tournament: PublicTournamentCard | null;
  competitor: MyTournamentState | null;
  nextAction: NextAction;
  countdown: {
    label: string;
    targetAt: Date | null;
  };
  checklist: Array<{
    key: string;
    label: string;
    complete: boolean;
  }>;
  sections: {
    overview: string;
    currentTournament: string;
    submission: string;
    evaluation: string;
    bracket: string;
    results: string;
    history: string;
    notifications: string;
    settings: string;
    profile: string;
  };
}

export function resolveMissionControl(input: {
  isSignedIn: boolean;
  tournament: PublicTournamentCard | null;
  competitor: MyTournamentState | null;
}): MissionControlState {
  const nextAction = resolveNextAction(input);
  const checklist = resolveChecklist(input.competitor);

  return {
    tournament: input.tournament,
    competitor: input.competitor,
    nextAction,
    countdown: resolveCountdown(input.tournament, input.competitor),
    checklist,
    sections: {
      overview: nextAction.body,
      currentTournament: input.tournament
        ? `${input.tournament.name} is ${formatState(input.tournament.status)}.`
        : 'No public tournament is scheduled.',
      submission: submissionSummary(input.competitor),
      evaluation: evaluationSummary(input.competitor),
      bracket: bracketSummary(input.tournament, input.competitor),
      results: resultsSummary(input.tournament, input.competitor),
      history: 'Your completed tournaments and score evidence live in results.',
      notifications:
        'Round openings, match results and prize updates land in notifications.',
      settings:
        'Profile details, connected identity and data export live in settings.',
      profile: 'Your public profile shows public badges and placements only.',
    },
  };
}

/**
 * E9.5: the dashboard's single server-side answer to "what should I do next?".
 * Components render this DTO; they do not re-derive product state.
 */
export function resolveNextAction(input: {
  isSignedIn: boolean;
  tournament: PublicTournamentCard | null;
  competitor: MyTournamentState | null;
}): NextAction {
  const { isSignedIn, tournament, competitor } = input;

  if (!isSignedIn) {
    return action(
      'SIGN_IN',
      'Sign in to compete',
      'Your workspace unlocks after authentication.',
      'Sign in',
      '/login?next=/dashboard',
      'blocked',
    );
  }

  if (!tournament) {
    return action(
      'NOTHING_NOW',
      'Nothing to do right now',
      'No public tournament is scheduled. Your history is still available.',
      'View results',
      '/results',
      'waiting',
    );
  }

  if (competitor && !competitor.readiness.profileComplete) {
    return action(
      'COMPLETE_PROFILE',
      'Complete your profile',
      'Add the verifiable profile details required before competition.',
      'Open settings',
      '/settings',
      'blocked',
    );
  }

  if (competitor && !competitor.readiness.termsAccepted) {
    return action(
      'ACCEPT_TERMS',
      'Accept the current terms',
      'Tournament entry requires the current competition terms.',
      'Open tournament',
      `/tournaments/${tournament.slug}`,
      'blocked',
    );
  }

  if (!competitor?.isRegistered) {
    if (tournament.status === 'REGISTRATION_OPEN') {
      return action(
        'PAY_ENTRY_FEE',
        tournament.passPriceMinor > 0 ? 'Pay entry fee' : 'Register now',
        tournament.passPriceMinor > 0
          ? 'Registration is open, but your paid entry is not active yet.'
          : 'Registration is open. Confirm your free beta entry.',
        tournament.passPriceMinor > 0 ? 'Pay entry fee' : 'Register',
        `/tournaments/${tournament.slug}`,
        'primary',
      );
    }

    return action(
      'NOTHING_NOW',
      'Nothing to do right now',
      'You are not registered for an active tournament.',
      'View tournaments',
      '/tournaments',
      'waiting',
    );
  }

  if (competitor.payment?.status === 'PENDING') {
    return action(
      'PAYMENT_PENDING',
      'Payment pending',
      'Your payment is waiting for gateway confirmation before the entry becomes final.',
      'Open tournament',
      `/tournaments/${tournament.slug}`,
      'waiting',
    );
  }

  if (competitor.payment?.status === 'CREATED') {
    return action(
      'PAY_ENTRY_FEE',
      'Pay entry fee',
      'Your checkout order exists, but payment is not complete.',
      'Resume payment',
      `/tournaments/${tournament.slug}`,
      'primary',
    );
  }

  if (competitor.payment?.status === 'FAILED') {
    return action(
      'PAYMENT_FAILED',
      'Payment failed',
      competitor.payment.failureReason ??
        'Retry payment from the tournament page.',
      'Retry payment',
      `/tournaments/${tournament.slug}`,
      'blocked',
    );
  }

  if (competitor.placement || tournament.status === 'COMPLETED') {
    return action(
      'TOURNAMENT_FINISHED',
      competitor.placement
        ? `Finished #${competitor.placement}`
        : 'Tournament finished',
      'Your final result is available in the results archive.',
      'View results',
      '/results',
      'done',
    );
  }

  if (competitor.eliminatedAtStage) {
    return action(
      'ELIMINATED',
      `Eliminated in ${formatState(competitor.eliminatedAtStage)}`,
      'Your run has ended. Follow the bracket or review your results.',
      'View results',
      '/results',
      'done',
    );
  }

  if (competitor.currentMatch) {
    // Checked before liveness. A bye is already won, so the round being OPEN
    // says nothing about this competitor — they were previously told to "Check
    // your match" and sent to an arena with no opponent, no problem statement
    // and no submit button.
    if (competitor.currentMatch.byeAwarded) {
      return action(
        'BYE_AWARDED',
        `Bye into ${formatState(competitor.currentMatch.stage)}`,
        'You advance without playing this round. Rest up — your next match is being decided.',
        'View bracket',
        '/bracket',
        'done',
      );
    }

    if (
      competitor.currentMatch.status === 'LIVE' ||
      competitor.currentMatch.roundStatus === 'OPEN'
    ) {
      return action(
        'MATCH_LIVE',
        'Check your match',
        competitor.currentMatch.opponentUsername
          ? `Your opponent is ${competitor.currentMatch.opponentUsername}.`
          : 'Your bracket match is live.',
        'Open arena',
        `/arena/knockout/${competitor.currentMatch.id}`,
        'primary',
      );
    }

    if (competitor.currentMatch.status === 'JUDGING') {
      return action(
        'AWAITING_EVALUATION',
        'Evaluation in progress',
        'Your match window closed and judging is underway.',
        'Open arena',
        `/arena/knockout/${competitor.currentMatch.id}`,
        'waiting',
      );
    }
  }

  if (competitor.currentRound) {
    if (competitor.currentRound.status === 'OPEN') {
      if (competitor.currentRound.submitted) {
        return action(
          'AWAITING_EVALUATION',
          'Submission received',
          `Your ${formatState(competitor.currentRound.stage)} entry is awaiting evaluation.`,
          competitor.currentRound.submissionId
            ? 'View submission'
            : 'View submissions',
          competitor.currentRound.submissionId
            ? `/submissions/${competitor.currentRound.submissionId}`
            : '/submissions',
          'waiting',
        );
      }

      return action(
        'SUBMIT_NOW',
        `${formatState(competitor.currentRound.stage)} is open`,
        'Submit before the deadline. The server decides the window.',
        'Submit entry',
        `/submit/${competitor.currentRound.id}`,
        'primary',
      );
    }

    if (competitor.currentRound.submissionStatus === 'SCORED') {
      return action(
        'VIEW_EVALUATION',
        'Evaluation done',
        'Your score and evidence are ready.',
        competitor.currentRound.submissionId
          ? 'View evaluation'
          : 'View submissions',
        competitor.currentRound.submissionId
          ? `/submissions/${competitor.currentRound.submissionId}`
          : '/submissions',
        'done',
      );
    }

    if (
      competitor.currentRound.status === 'JUDGING' ||
      competitor.currentRound.submitted
    ) {
      return action(
        'AWAITING_EVALUATION',
        'Awaiting evaluation',
        'Your submission is in the judging queue.',
        'View submissions',
        '/submissions',
        'waiting',
      );
    }
  }

  if (competitor.qualified) {
    return action(
      'REGISTERED_WAITING',
      'Qualified and waiting',
      competitor.seed
        ? `You are seed #${competitor.seed}. The next bracket step appears here.`
        : 'You qualified. The next bracket step appears here.',
      'Open bracket',
      `/bracket/${tournament.id}`,
      'waiting',
    );
  }

  return action(
    'REGISTERED_WAITING',
    'Registered and waiting',
    'Your entry is active. Watch the countdown and keep your profile ready.',
    'Open tournament',
    `/tournaments/${tournament.slug}`,
    'waiting',
  );
}

function resolveChecklist(competitor: MyTournamentState | null) {
  if (!competitor) return [];
  return [
    {
      key: 'github',
      label: 'GitHub connected',
      complete: competitor.readiness.githubConnected,
    },
    {
      key: 'profile',
      label: 'Display name and city set',
      complete: competitor.readiness.profileLocationSet,
    },
    {
      key: 'terms',
      label: 'Terms accepted',
      complete: competitor.readiness.termsAccepted,
    },
    {
      key: 'registration',
      label: 'Registered',
      complete: competitor.readiness.registered,
    },
    {
      key: 'payment',
      label: 'Payment settled',
      complete: competitor.readiness.paymentSettled,
    },
    {
      key: 'submitted',
      label: 'Submitted current round',
      complete: competitor.currentRound?.submitted ?? false,
    },
  ];
}

function resolveCountdown(
  tournament: PublicTournamentCard | null,
  competitor: MyTournamentState | null,
): { label: string; targetAt: Date | null } {
  // A bye has no clock. Counting down "time remaining" against a deadline the
  // competitor cannot act on is theatre, and it implies work they don't owe.
  if (competitor?.currentMatch && !competitor.currentMatch.byeAwarded) {
    return {
      label:
        competitor.currentMatch.roundStatus === 'OPEN'
          ? 'Time remaining'
          : 'Round opens',
      targetAt:
        competitor.currentMatch.roundStatus === 'OPEN'
          ? competitor.currentMatch.deadlineAt
          : competitor.currentMatch.opensAt,
    };
  }
  if (competitor?.currentRound) {
    return {
      label:
        competitor.currentRound.status === 'OPEN'
          ? 'Time remaining'
          : 'Round opens',
      targetAt:
        competitor.currentRound.status === 'OPEN'
          ? competitor.currentRound.deadlineAt
          : competitor.currentRound.opensAt,
    };
  }
  if (tournament?.status === 'REGISTRATION_OPEN') {
    return {
      label: 'Registration closes',
      targetAt: tournament.registrationClosesAt,
    };
  }
  return {
    label: 'Registration opens',
    targetAt: tournament?.registrationOpensAt ?? null,
  };
}

function submissionSummary(competitor: MyTournamentState | null): string {
  if (!competitor?.currentRound) return 'No active submission window.';
  if (competitor.currentRound.submitted) return 'Current round entry received.';
  if (competitor.currentRound.status === 'OPEN')
    return 'Submission is due now.';
  return 'Submission window is not open.';
}

function evaluationSummary(competitor: MyTournamentState | null): string {
  const status = competitor?.currentRound?.submissionStatus;
  if (status === 'SCORED') return 'Evaluation evidence is ready.';
  if (status === 'FAILED') return 'Evaluation needs attention.';
  if (status === 'JUDGING' || status === 'QUEUED') {
    return 'Evaluation is in progress.';
  }
  return 'No evaluation result for the current round.';
}

function bracketSummary(
  tournament: PublicTournamentCard | null,
  competitor: MyTournamentState | null,
): string {
  if (competitor?.currentMatch) {
    return `Current match: ${formatState(competitor.currentMatch.stage)}.`;
  }
  if (competitor?.qualified) return 'You qualified for the bracket.';
  if (tournament)
    return `Bracket size: ${tournament.bracketSize ?? 'pending'}.`;
  return 'No bracket selected.';
}

function resultsSummary(
  tournament: PublicTournamentCard | null,
  competitor: MyTournamentState | null,
): string {
  if (competitor?.placement) return `Final placement #${competitor.placement}.`;
  if (competitor?.eliminatedAtStage) {
    return `Eliminated in ${formatState(competitor.eliminatedAtStage)}.`;
  }
  if (tournament?.status === 'COMPLETED') return 'Tournament is complete.';
  return 'No final result yet.';
}

function action(
  kind: NextActionKind,
  title: string,
  body: string,
  label: string,
  href: string,
  priority: NextAction['priority'],
): NextAction {
  return { kind, title, body, label, href, priority };
}

function formatState(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}
