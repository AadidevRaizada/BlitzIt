import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProfileByUsername } from '@/server/modules/auth/profile';
import { listUserBadges } from '@/server/modules/hall-of-fame';
import { listPublicPlacements } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

/** Public profile page. Readable signed-out — no session required. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return { title: `${username} — Blitz It` };
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
  // `publicOnly` on both: this page is readable by anyone, and a badge carries
  // the name of the tournament that awarded it. A rehearsal runs UNLISTED and
  // must not be announced here.
  const [badges, placements] = await Promise.all([
    listUserBadges(user.id, { publicOnly: true }),
    listPublicPlacements(user.id),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          {user.displayName ?? user.username}
        </h1>
        <p className="text-muted-foreground text-sm">@{user.username}</p>
        {user.city ? (
          <p className="text-muted-foreground text-sm">{user.city}</p>
        ) : null}
      </header>

      {profile?.bio ? <p className="text-sm">{profile.bio}</p> : null}

      <dl className="space-y-2 text-sm">
        {profile?.githubUsername ? (
          <Row label="GitHub" value={`@${profile.githubUsername}`} />
        ) : null}
        {profile?.twitterHandle ? (
          <Row label="X / Twitter" value={`@${profile.twitterHandle}`} />
        ) : null}
        {profile?.websiteUrl ? (
          <Row label="Website" value={profile.websiteUrl} />
        ) : null}
        <Row
          label="Member since"
          value={user.createdAt.toISOString().slice(0, 10)}
        />
      </dl>

      {/* E8.4 — badges and placements. Public because placements are public
          (D10); the code behind them is not, and never appears here (D28). */}
      {badges.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Badges
          </h2>
          <ul className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <li key={`${badge.slug}-${badge.tournamentId ?? 'global'}`}>
                <Badge tone={badge.slug === 'champion' ? 'success' : 'brand'}>
                  {badge.name}
                  {badge.tournamentName ? ` · ${badge.tournamentName}` : ''}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {placements.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Tournament history
          </h2>
          <ul className="space-y-1.5 text-sm">
            {placements.map((entry) => (
              <li
                key={entry.tournamentId}
                className="border-border/60 flex flex-wrap items-baseline justify-between gap-2 border-b pb-1.5 last:border-0"
              >
                <Link
                  href={`/bracket/${entry.tournamentId}`}
                  className="hover:text-primary hover:underline"
                >
                  {entry.tournamentName}
                </Link>
                <span className="text-muted-foreground tabular-nums">
                  {entry.placement
                    ? `#${entry.placement}`
                    : entry.eliminatedAtStage
                      ? `out · ${entry.eliminatedAtStage.replace(/_/g, ' ')}`
                      : 'entered'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground w-32 shrink-0">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
