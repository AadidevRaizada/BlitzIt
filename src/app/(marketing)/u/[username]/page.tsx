import { notFound } from 'next/navigation';
import { getProfileByUsername } from '@/server/modules/auth/profile';

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
