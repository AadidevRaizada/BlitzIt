import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/modules/auth';
import { getRevealedRound, isRegistered } from '@/server/modules/tournament';
import { getMySubmission } from '@/server/modules/submission';
import { computeCountdown } from '@/server/modules/tournament/timers.public';
import { SubmissionStatusBadge } from '@/components/features/submission-status-badge';
import { Countdown } from '@/components/features/countdown';
import { SubmissionForm } from '@/components/features/submission-form';

export const metadata = { title: 'Submit - The Circuit' };

/**
 * Screen [9] — Problem + Submission (E4).
 *
 * Reads go through the modules, never through Prisma directly: the Tournament
 * module owns the reveal gate (`opensAt`) and the window, the Submission module
 * owns the entry. Hidden tests are never selected by either — they must not
 * leave the server even by accident.
 */
export default async function SubmitPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const { roundId } = await params;
  const user = await requireUser(`/submit/${roundId}`);

  const round = await getRevealedRound(roundId);
  if (!round) notFound();

  const registered = await isRegistered(round.tournamentId, user.id);
  const existing = await getMySubmission(user.id, roundId);

  const window = round.window;
  const now = new Date();
  const serverTime = now.toISOString();
  const countdown = computeCountdown(window, now);
  // The module decides when the statement is revealed; a competitor must also
  // be registered to see it at all.
  const revealed = round.revealed && registered;
  const editable = registered && window.isOpen && !existing?.sealedAt;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            {round.tournamentName} · {round.stage}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            {revealed ? (round.problem?.title ?? 'Problem') : 'Round locked'}
          </h1>
        </div>
        {existing ? <SubmissionStatusBadge state={existing.state} /> : null}
      </div>

      <dl className="border-border grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border p-4 text-sm sm:grid-cols-4">
        <Meta label="Status" value={window.status} />
        <Meta
          label="Opens"
          value={window.opensAt ? formatUtc(window.opensAt) : '—'}
        />
        <Meta
          label="Deadline"
          value={window.deadlineAt ? formatUtc(window.deadlineAt) : '—'}
        />
        <div>
          <dt className="text-muted-foreground text-xs">
            {countdown.label === 'OPENS' ? 'Opens in' : 'Time left'}
          </dt>
          <dd>
            {/* Server-authoritative (E7.1): the browser is given the deadline
                and the server's clock, and corrects its own against it. */}
            <Countdown
              targetAt={countdown.targetAt}
              serverTime={serverTime}
              phase={countdown.phase}
              className="text-sm"
            />
          </dd>
        </div>
      </dl>

      {!registered ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          You are not registered for this tournament.
        </p>
      ) : null}

      {revealed && round.problem ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Problem
          </h2>
          <div className="border-border rounded-md border p-4">
            <p className="text-muted-foreground mb-2 text-xs">
              Category: {round.problem.category}
            </p>
            <pre className="text-sm whitespace-pre-wrap">
              {round.problem.statementMarkdown}
            </pre>
          </div>
        </section>
      ) : (
        <div className="border-border rounded-md border border-dashed p-8 text-center">
          <p className="font-medium">The problem has not been revealed yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            It becomes visible to every competitor at the same moment the round
            opens.
          </p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {existing ? 'Your entry' : 'Submit your entry'}
        </h2>
        <SubmissionForm
          roundId={roundId}
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
          editable={editable}
        />
        {existing ? (
          <p className="text-sm">
            <Link
              href={`/submissions/${existing.id}`}
              className="text-primary hover:underline"
            >
              View evaluation status →
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** All timestamps are stored UTC (D8); IST display arrives with the arena. */
function formatUtc(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 16)}Z`;
}
