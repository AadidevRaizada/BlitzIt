import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, MapPin, Trophy, UserRound } from 'lucide-react';
import { getProfileByUsername } from '@/server/modules/auth/profile';
import { listUserBadges } from '@/server/modules/hall-of-fame';
import { listPublicPlacements } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Section } from '@/components/ui/section';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return { title: `${username} - The Circuit` };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const user = await getProfileByUsername(username);
  if (!user) notFound();

  const profile = user.profile;
  const [badges, placements] = await Promise.all([
    listUserBadges(user.id, { publicOnly: true }),
    listPublicPlacements(user.id),
  ]);

  return (
    <main>
      <Section className="bg-surface-deep">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.75fr]">
          <div>
            <div className="bg-secondary text-secondary-foreground mb-6 flex size-16 items-center justify-center rounded-lg">
              <UserRound className="size-8" aria-hidden />
            </div>
            <DisplayHeading as="h1">
              {user.displayName ?? user.username}
            </DisplayHeading>
            <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span>@{user.username}</span>
              {user.city ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-4" aria-hidden />
                  {user.city}
                </span>
              ) : null}
              <span>
                Member since {user.createdAt.toISOString().slice(0, 10)}
              </span>
            </div>
            {profile?.bio ? (
              <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-8">
                {profile.bio}
              </p>
            ) : null}
          </div>

          <Card surface="broadcast" className="p-5">
            <p className="text-muted-foreground text-sm">Public medals</p>
            <p className="mt-2 text-5xl font-extrabold tabular-nums">
              {badges.length}
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              Badges from listed tournaments only.
            </p>
          </Card>
        </div>
      </Section>

      <Section className="bg-background">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Card surface="broadcast" className="p-5">
            <h2 className="font-bold">Links</h2>
            <dl className="mt-4 space-y-3 text-sm">
              {profile?.githubUsername ? (
                <Row label="GitHub" value={`@${profile.githubUsername}`} />
              ) : null}
              {profile?.twitterHandle ? (
                <Row label="X / Twitter" value={`@${profile.twitterHandle}`} />
              ) : null}
              {profile?.websiteUrl ? (
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">Website</dt>
                  <dd>
                    <a
                      href={profile.websiteUrl}
                      className="text-primary hover:text-secondary focus-visible:ring-ring inline-flex items-center gap-1 rounded-md break-all focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {profile.websiteUrl}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </dd>
                </div>
              ) : null}
              {!profile?.githubUsername &&
              !profile?.twitterHandle &&
              !profile?.websiteUrl ? (
                <p className="text-muted-foreground">No public links yet.</p>
              ) : null}
            </dl>
          </Card>

          <div className="space-y-6">
            <Card surface="broadcast" className="p-5">
              <h2 className="font-bold">Badges</h2>
              {badges.length > 0 ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {badges.map((badge) => (
                    <li key={`${badge.slug}-${badge.tournamentId ?? 'global'}`}>
                      <Badge
                        tone={badge.slug === 'champion' ? 'success' : 'brand'}
                      >
                        {badge.name}
                        {badge.tournamentName
                          ? `, ${badge.tournamentName}`
                          : ''}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground mt-4 text-sm">
                  No public badges yet.
                </p>
              )}
            </Card>

            <Card surface="broadcast" className="p-5">
              <h2 className="font-bold">Tournament History</h2>
              {placements.length > 0 ? (
                <ul className="divide-border/60 mt-4 divide-y text-sm">
                  {placements.map((entry) => (
                    <li
                      key={entry.tournamentId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <Link
                        href={`/bracket/${entry.tournamentId}`}
                        className="hover:text-primary focus-visible:ring-ring rounded-md font-medium focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {entry.tournamentName}
                      </Link>
                      <span className="text-muted-foreground inline-flex items-center gap-1 tabular-nums">
                        <Trophy className="size-4" aria-hidden />
                        {entry.placement
                          ? `#${entry.placement}`
                          : entry.eliminatedAtStage
                            ? `out, ${entry.eliminatedAtStage.replace(/_/g, ' ')}`
                            : 'entered'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground mt-4 text-sm">
                  No public tournament history yet.
                </p>
              )}
            </Card>
          </div>
        </div>
      </Section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
