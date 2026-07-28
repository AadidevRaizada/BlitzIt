import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, MapPin, Trophy, UserRound } from 'lucide-react';
import { getProfileByUsername } from '@/server/modules/auth/profile';
import { listUserBadges } from '@/server/modules/hall-of-fame';
import { listPublicPlacements } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { EmptyState } from '@/components/ui/empty-state';
import { Eyebrow } from '@/components/ui/eyebrow';
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
  const hasLinks = Boolean(
    profile?.githubUsername ?? profile?.twitterHandle ?? profile?.websiteUrl,
  );

  return (
    <main>
      <Section className="bg-surface-deep">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.75fr]">
          <div>
            <div className="bg-primary text-primary-foreground mb-6 flex size-16 items-center justify-center rounded-lg">
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

          <Card surface="broadcast" className="h-fit p-5">
            <Eyebrow>Public medals</Eyebrow>
            <p className="font-display mt-2 text-5xl font-bold tabular-nums">
              {badges.length}
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              Badges from listed tournaments only.
            </p>
          </Card>
        </div>
      </Section>

      {/*
       * One scannable column rather than three boxy cards.
       *
       * Links, badges and history used to be separate bordered panels with
       * near-identical "No X yet" copy, so a new profile rendered as three
       * empty boxes and read as a broken page. They are now inline sections
       * that simply do not render when they have nothing to show — a sparse
       * profile is short, not visibly hollow. Tournament history is the only
       * one that keeps an explicit empty state, because it is the section a
       * visitor actually came to read.
       */}
      <Section className="bg-background">
        <div className="max-w-3xl space-y-10">
          {hasLinks ? (
            <div>
              <Eyebrow>Links</Eyebrow>
              <ul className="mt-3 flex flex-wrap gap-2">
                {profile?.githubUsername ? (
                  <LinkChip
                    href={`https://github.com/${profile.githubUsername}`}
                    label={`@${profile.githubUsername}`}
                  />
                ) : null}
                {profile?.twitterHandle ? (
                  <LinkChip
                    href={`https://x.com/${profile.twitterHandle}`}
                    label={`@${profile.twitterHandle}`}
                  />
                ) : null}
                {profile?.websiteUrl ? (
                  <LinkChip
                    href={profile.websiteUrl}
                    label={profile.websiteUrl}
                  />
                ) : null}
              </ul>
            </div>
          ) : null}

          {badges.length > 0 ? (
            <div>
              <Eyebrow>Badges</Eyebrow>
              <ul className="mt-3 flex flex-wrap gap-2">
                {badges.map((badge) => (
                  <li key={`${badge.slug}-${badge.tournamentId ?? 'global'}`}>
                    <Badge
                      tone={badge.slug === 'champion' ? 'success' : 'brand'}
                    >
                      {badge.name}
                      {badge.tournamentName ? `, ${badge.tournamentName}` : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <Eyebrow>Tournament history</Eyebrow>
            {placements.length > 0 ? (
              <ul className="divide-border/60 mt-3 divide-y text-sm">
                {placements.map((entry) => (
                  <li
                    key={entry.tournamentId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <Link
                      href={`/bracket/${entry.tournamentId}`}
                      className="hover:text-primary focus-visible:ring-ring rounded-md font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {entry.tournamentName}
                    </Link>
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 tabular-nums">
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
              <EmptyState title="No public tournament history yet" />
            )}
          </div>
        </div>
      </Section>
    </main>
  );
}

function LinkChip({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        rel="nofollow noopener noreferrer"
        target="_blank"
        className="border-hairline bg-surface-raised text-foreground hover:border-primary/40 hover:text-primary focus-visible:ring-ring inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="truncate">{label}</span>
        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      </a>
    </li>
  );
}
