import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/modules/auth';
import {
  getKnockoutArena,
  getLiveSnapshot,
  isRegistered,
} from '@/server/modules/tournament';
import {
  ARENA_STATE_LABEL,
  isArenaActionable,
} from '@/server/modules/tournament/arena.public';
import { classifySubmissionTiming } from '@/server/modules/tournament/timers.public';
import { getMySubmission, hasSubmission } from '@/server/modules/submission';
import { isLiveArenaEnabled } from '@/lib/flags';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Countdown } from '@/components/features/countdown';
import { LiveRefresh } from '@/components/features/live-refresh';
import { SubmissionForm } from '@/components/features/submission-form';
import { SubmissionStatusBadge } from '@/components/features/submission-status-badge';

export const metadata = { title: 'Knockout Arena - Blitz It' };
export const dynamic = 'force-dynamic';

export default async function KnockoutArenaPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const user = await requireUser(`/arena/knockout/${matchId}`);

  const arena = await getKnockoutArena(matchId, user.id);
  if (!arena) notFound();

  const enabled = await isLiveArenaEnabled({ id: user.id, role: user.role });
  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title="The live arena is not available"
          description="This surface is being rolled out. Your round is unaffected, submit from the round page as usual."
        />
        <Link
          href={`/submit/${arena.round.id}`}
          className="text-primary text-sm hover:underline"
        >
          Go to the round
        </Link>
      </div>
    );
  }

  const registered = await isRegistered(arena.tournament.id, user.id);
  const existing = await getMySubmission(user.id, arena.round.id);
  const opponentSubmitted =
    arena.mayRevealOpponentProgress && arena.opponent
      ? await hasSubmission(arena.opponent.userId, arena.round.id)
      : null;
  const { version } = await getLiveSnapshot(arena.tournament.id);
  const window = arena.window;
  const actionable = isArenaActionable(arena.state) && registered;
  const timing = classifySubmissionTiming(
    window,
    existing?.submittedAt ?? null,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section
        data-surface="broadcast"
        className="bg-surface-deep text-foreground border-hairline rounded-xl border p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATE_TONE[arena.state]}>
                {ARENA_STATE_LABEL[arena.state]}
              </Badge>
              <LiveRefresh
                tournamentId={arena.tournament.id}
                initialVersion={version}
              />
            </div>
            <h1 className="mt-4 text-2xl font-extrabold tracking-[-0.03em] sm:text-4xl">
              {arena.round.stage.replace('_', ' ')} · {arena.tournament.name}
            </h1>
          </div>
          <Link
            href={`/bracket/${arena.tournament.id}`}
            className="text-primary hover:text-secondary focus-visible:ring-ring rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Full bracket
          </Link>
        </div>

        <Card
          surface="broadcast"
          className="mt-5 grid gap-4 p-4 sm:grid-cols-[1fr_auto_1fr]"
        >
          <Side
            name={user.displayName ?? user.username}
            seed={arena.viewer.seed}
            you
            submitted={existing !== null}
            isWinner={arena.winnerId === user.id}
            decided={arena.matchStatus === 'DECIDED'}
          />
          <div className="flex flex-col items-center justify-center gap-1">
            <span className="text-muted-foreground text-xs tracking-widest uppercase">
              vs
            </span>
            <Countdown
              targetAt={window.countdown.targetAt}
              serverTime={arena.serverTime}
              phase={window.phase}
              label={
                window.countdown.label === 'OPENS' ? 'opens in' : undefined
              }
              className="[&>span:last-child]:text-2xl [&>span:last-child]:font-extrabold"
            />
          </div>
          <Side
            name={
              arena.opponent?.displayName ?? arena.opponent?.username ?? null
            }
            seed={arena.opponent?.seed ?? null}
            submitted={opponentSubmitted}
            isWinner={
              arena.opponent != null && arena.winnerId === arena.opponent.userId
            }
            decided={arena.matchStatus === 'DECIDED'}
            alignEnd
          />
        </Card>
      </section>

      {arena.resolves ? (
        <p className="border-warning/40 bg-warning/10 rounded-md border px-3 py-2 text-sm">
          <strong>Sudden death.</strong> This is a decider for your{' '}
          {arena.resolves.stage.replace('_', ' ')} match, which every tie-break
          failed to separate. It is scored on{' '}
          <strong>functional correctness alone</strong> (D14).
        </p>
      ) : null}

      {arena.state === 'TIED' ? (
        <p className="border-warning/40 bg-warning/10 rounded-md border px-3 py-2 text-sm">
          <strong>Dead heat.</strong> Neither the score nor any tie-break could
          separate you. An organiser will open a short sudden-death challenge.
        </p>
      ) : null}

      {arena.state === 'SUDDEN_DEATH' && arena.suddenDeath ? (
        <p className="border-primary/40 bg-primary/10 rounded-md border px-3 py-2 text-sm">
          <strong>Sudden death is live.</strong>{' '}
          <Link
            href={`/arena/knockout/${arena.suddenDeath.matchId}`}
            className="text-primary underline"
          >
            Go to the decider
          </Link>
        </p>
      ) : null}

      {!arena.mayRevealOpponentProgress ? (
        <p className="text-muted-foreground text-xs">
          Your opponent&rsquo;s progress stays hidden until the window closes,
          so nobody gets to play the other person instead of the problem.
        </p>
      ) : null}

      {arena.matchStatus === 'DECIDED' ? (
        <section
          className={
            arena.state === 'WON'
              ? 'border-success/40 bg-success/10 rounded-lg border p-4'
              : 'border-border bg-muted/40 rounded-lg border p-4'
          }
        >
          <h2 className="font-semibold">
            {arena.state === 'WON' ? 'You advanced' : 'Your run ends here'}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {arena.winReason
              ? `Decided ${WIN_REASON_LABEL[arena.winReason] ?? arena.winReason}.`
              : 'Decided.'}{' '}
            {arena.state === 'WON'
              ? 'Your next match appears here once the bracket moves.'
              : 'Your placement is recorded on the bracket.'}
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Challenge
        </h2>
        {arena.revealed && arena.problem ? (
          <div className="border-border rounded-md border p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{arena.problem.title}</h3>
              <Badge tone="neutral">{arena.problem.category}</Badge>
            </div>
            <pre className="text-sm whitespace-pre-wrap">
              {arena.problem.statementMarkdown}
            </pre>
          </div>
        ) : (
          <div className="border-border rounded-md border border-dashed p-8 text-center">
            <p className="font-medium">The challenge is still sealed</p>
            <p className="text-muted-foreground mt-1 text-sm">
              It is revealed to every competitor at the same instant the round
              opens.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            {existing ? 'Your entry' : 'Submit your entry'}
          </h2>
          <div className="flex items-center gap-2">
            {timing === 'LATE' ? <Badge tone="danger">Late</Badge> : null}
            {existing ? <SubmissionStatusBadge state={existing.state} /> : null}
          </div>
        </div>

        {!registered ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            You are not registered for this tournament.
          </p>
        ) : (
          <SubmissionForm
            roundId={arena.round.id}
            redirectTo={`/arena/knockout/${arena.matchId}`}
            editable={actionable && window.isOpen && !existing?.sealedAt}
            closedHint={
              arena.state === 'JUDGING'
                ? 'The window has closed. Evaluations are still running, results appear here as soon as the match is decided.'
                : arena.state === 'WAITING'
                  ? 'The round has not opened yet.'
                  : undefined
            }
            existing={
              existing
                ? {
                    repoUrl: existing.repoUrl,
                    deploymentUrl: existing.deploymentUrl,
                    commitSha: existing.commitSha,
                    version: existing.version,
                  }
                : null
            }
          />
        )}

        {existing ? (
          <p className="text-sm">
            <Link
              href={`/submissions/${existing.id}`}
              className="text-primary hover:underline"
            >
              Evaluation detail
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}

const STATE_TONE: Readonly<Record<string, BadgeTone>> = {
  WAITING: 'neutral',
  LIVE: 'brand',
  JUDGING: 'info',
  TIED: 'warning',
  SUDDEN_DEATH: 'warning',
  WON: 'success',
  LOST: 'danger',
  NOT_STARTED: 'neutral',
};

const WIN_REASON_LABEL: Readonly<Record<string, string>> = {
  SCORE: 'on overall score',
  TIEBREAK_FUNCTIONAL: 'on functional score',
  TIEBREAK_TESTS: 'on hidden tests passed',
  TIEBREAK_TIME: 'on submission time',
  TIEBREAK_PERFORMANCE: 'on performance',
  TIEBREAK_AI: 'on AI score',
  SUDDEN_DEATH: 'by sudden death',
  BYE: 'by bye',
  WALKOVER: 'by walkover',
  ADMIN: 'by an organiser',
};

function Side({
  name,
  seed,
  you = false,
  submitted,
  isWinner,
  decided,
  alignEnd = false,
}: {
  name: string | null;
  seed: number | null;
  you?: boolean;
  submitted: boolean | null;
  isWinner: boolean;
  decided: boolean;
  alignEnd?: boolean;
}) {
  return (
    <div className={alignEnd ? 'sm:text-right' : ''}>
      <p
        className={
          decided && !isWinner
            ? 'text-muted-foreground font-medium line-through'
            : 'font-medium'
        }
      >
        {name ?? 'Bye'}
        {you ? (
          <span className="text-primary ml-1 text-xs font-medium">(you)</span>
        ) : null}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
        {seed != null ? `Seed #${seed}` : 'Unseeded'}
        {submitted === null
          ? ''
          : submitted
            ? ' · entry received'
            : ' · no entry'}
      </p>
    </div>
  );
}
