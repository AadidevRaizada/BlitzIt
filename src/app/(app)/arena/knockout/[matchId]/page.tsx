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
import { PageHeader } from '@/components/ui/page-header';
import { Countdown } from '@/components/features/countdown';
import { LiveRefresh } from '@/components/features/live-refresh';
import { SubmissionForm } from '@/components/features/submission-form';
import { SubmissionStatusBadge } from '@/components/features/submission-status-badge';

export const metadata = { title: 'Knockout Arena — Blitz It' };
export const dynamic = 'force-dynamic';

/**
 * Screen [10] — the Live Knockout Arena (E7.2).
 *
 * One match, head to head. The page renders on the server — the reveal gate,
 * the window and the authorization all stay in one place — and a small client
 * island keeps it live: the countdown ticks locally against a server anchor,
 * and `LiveRefresh` re-runs this render when the tournament snapshot changes.
 *
 * ## Rules this screen has to get right
 *
 * - **Disconnects cost nothing.** Everything shown is persisted. Reloading
 *   after a crash restores the same state with the same time remaining,
 *   because the deadline is an absolute instant the server wrote down.
 * - **Late submissions are refused by the server**, not by hiding the button.
 *   The form disappears when the window closes, but that is a courtesy; the
 *   Submission module is what actually enforces it.
 * - **Judging can outlast the timer.** When the window closes with the match
 *   undecided the arena says so, rather than implying something is wrong.
 */
export default async function KnockoutArenaPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const user = await requireUser(`/arena/knockout/${matchId}`);

  // Only the two competitors can open their own arena; everyone else gets the
  // bracket. `getKnockoutArena` returns null rather than throwing so this page
  // cannot leak "that match exists, but not for you".
  const arena = await getKnockoutArena(matchId, user.id);
  if (!arena) notFound();

  const enabled = await isLiveArenaEnabled({ id: user.id, role: user.role });
  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title="The live arena is not available"
          description="This surface is being rolled out. Your round is unaffected — submit from the round page as usual."
        />
        <Link
          href={`/submit/${arena.round.id}`}
          className="text-primary text-sm hover:underline"
        >
          Go to the round →
        </Link>
      </div>
    );
  }

  const registered = await isRegistered(arena.tournament.id, user.id);
  const existing = await getMySubmission(user.id, arena.round.id);
  // Composition, not a module reaching across a boundary: the Tournament module
  // decides *whether* the opponent's progress may be shown, the Submission
  // module answers *whether they submitted*, and this page joins the two.
  const opponentSubmitted =
    arena.mayRevealOpponentProgress && arena.opponent
      ? await hasSubmission(arena.opponent.userId, arena.round.id)
      : null;
  // The baseline for `LiveRefresh` — the snapshot version this render is built
  // from, so a change landing before the stream connects is not swallowed.
  const { version } = await getLiveSnapshot(arena.tournament.id);
  const window = arena.window;
  const actionable = isArenaActionable(arena.state) && registered;
  const timing = classifySubmissionTiming(
    window,
    existing?.submittedAt ?? null,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`${arena.round.stage.replace('_', ' ')} · ${arena.tournament.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATE_TONE[arena.state]}>
              {ARENA_STATE_LABEL[arena.state]}
            </Badge>
            <LiveRefresh
              tournamentId={arena.tournament.id}
              initialVersion={version}
            />
          </span>
        }
        actions={
          <Link
            href={`/bracket/${arena.tournament.id}`}
            className="text-primary text-sm hover:underline"
          >
            Full bracket →
          </Link>
        }
      />

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
          separate you. An organiser will open a short sudden-death challenge —
          watch this page.
        </p>
      ) : null}

      {arena.state === 'SUDDEN_DEATH' && arena.suddenDeath ? (
        <p className="border-primary/40 bg-primary/10 rounded-md border px-3 py-2 text-sm">
          <strong>Sudden death is live.</strong>{' '}
          <Link
            href={`/arena/knockout/${arena.suddenDeath.matchId}`}
            className="text-primary underline"
          >
            Go to the decider →
          </Link>
        </p>
      ) : null}

      {/* ── Head to head ─────────────────────────────────────────── */}
      <section className="border-border grid gap-4 rounded-lg border p-4 sm:grid-cols-[1fr_auto_1fr]">
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
            label={window.countdown.label === 'OPENS' ? 'opens in' : undefined}
          />
        </div>
        <Side
          name={arena.opponent?.displayName ?? arena.opponent?.username ?? null}
          seed={arena.opponent?.seed ?? null}
          submitted={opponentSubmitted}
          isWinner={
            arena.opponent != null && arena.winnerId === arena.opponent.userId
          }
          decided={arena.matchStatus === 'DECIDED'}
          alignEnd
        />
      </section>

      {!arena.mayRevealOpponentProgress ? (
        <p className="text-muted-foreground text-xs">
          Your opponent&rsquo;s progress stays hidden until the window closes —
          nobody gets to play the other person instead of the problem.
        </p>
      ) : null}

      {/* ── Result ───────────────────────────────────────────────── */}
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

      {/* ── Problem ──────────────────────────────────────────────── */}
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

      {/* ── Submission ───────────────────────────────────────────── */}
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
                ? 'The window has closed. Evaluations are still running — results appear here as soon as the match is decided.'
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
              Evaluation detail →
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
  /** Null means "deliberately withheld", not "no". */
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
