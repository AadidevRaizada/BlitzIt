import Link from 'next/link';
import { Medal, Trophy } from 'lucide-react';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import { formatMinor } from '@/server/modules/notification';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Section } from '@/components/ui/section';
import { EmptyState } from '@/components/ui/table';

export const metadata = { title: 'Hall of Fame - The Circuit' };
export const dynamic = 'force-dynamic';

export default async function HallOfFamePage() {
  const entries = await listHallOfFame({ take: 100 });

  return (
    <main>
      <Section className="bg-surface-deep">
        <p className="text-secondary text-sm font-bold">Permanent record</p>
        <DisplayHeading as="h1" className="mt-3">
          Hall of Fame
        </DisplayHeading>
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg">
          Every published tournament, its podium, and the field it was won
          against.
        </p>
      </Section>

      <Section className="bg-background">
        {entries.length === 0 ? (
          <EmptyState
            title="No champions yet"
            hint="The first tournament to finish will be recorded here."
          />
        ) : (
          <ol className="space-y-5">
            {entries.map((entry, index) => (
              <li key={entry.tournamentId}>
                <Card surface="broadcast" className="overflow-hidden">
                  <div className="grid gap-0 lg:grid-cols-[1.15fr_1fr]">
                    <div className="bg-surface-elevated p-6">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground text-sm tabular-nums">
                          #{index + 1}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {entry.publishedAt.toISOString().slice(0, 10)}
                        </span>
                      </div>
                      <Trophy className="text-secondary mt-14 size-10" />
                      <p className="text-muted-foreground mt-4 text-sm">
                        Champion
                      </p>
                      <h2 className="mt-2 text-4xl font-extrabold tracking-[-0.035em]">
                        <Person
                          username={entry.champion?.username ?? null}
                          name={
                            entry.champion?.displayName ??
                            entry.champion?.username ??
                            null
                          }
                        />
                      </h2>
                      {entry.champion?.city ? (
                        <p className="text-muted-foreground mt-2">
                          {entry.champion.city}
                        </p>
                      ) : null}
                    </div>

                    <div className="p-6">
                      <h3 className="text-xl font-bold">
                        {entry.tournamentName}
                      </h3>
                      <p className="text-muted-foreground mt-2 text-sm tabular-nums">
                        {entry.participantCount} competitors,{' '}
                        {formatMinor(entry.prizePoolMinor)} prize pool
                      </p>

                      <div className="mt-8 grid gap-3 sm:grid-cols-2">
                        <Place
                          rank="Runner-up"
                          username={entry.runnerUp?.username ?? null}
                          name={
                            entry.runnerUp?.displayName ??
                            entry.runnerUp?.username ??
                            null
                          }
                        />
                        <Place
                          rank="Third"
                          username={entry.thirdPlace?.username ?? null}
                          name={
                            entry.thirdPlace?.displayName ??
                            entry.thirdPlace?.username ??
                            null
                          }
                        />
                      </div>

                      <Link
                        href={`/bracket/${entry.tournamentId}`}
                        className="text-primary hover:text-secondary focus-visible:ring-ring mt-8 inline-flex rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
                      >
                        See bracket
                      </Link>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </main>
  );
}

function Place({
  rank,
  name,
  username,
}: {
  rank: string;
  name: string | null;
  username: string | null;
}) {
  return (
    <div className="border-hairline bg-surface-deep min-h-28 border p-4">
      <Medal className="text-primary size-5" aria-hidden />
      <p className="text-muted-foreground mt-4 text-sm">{rank}</p>
      <p className="mt-1 font-semibold">
        <Person username={username} name={name} />
      </p>
    </div>
  );
}

function Person({
  username,
  name,
}: {
  username: string | null;
  name: string | null;
}) {
  if (!name || !username) {
    return <span className="text-muted-foreground">Unclaimed</span>;
  }

  return (
    <Link
      href={`/u/${username}`}
      className="hover:text-primary focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      {name}
    </Link>
  );
}
