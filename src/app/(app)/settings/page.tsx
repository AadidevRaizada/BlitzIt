import { notFound } from 'next/navigation';
import { requireUser } from '@/server/modules/auth';
import { getEditableProfile } from '@/server/modules/auth/profile';
import { ProfileForm } from './profile-form';

export const metadata = { title: 'Settings - The Circuit' };

/** Profile edit screen for the signed-in user. */
export default async function SettingsPage() {
  const user = await requireUser('/settings');
  const profile = await getEditableProfile(user.id);
  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile settings</h1>
        <p className="text-muted-foreground text-sm">
          This information appears on your public profile.
        </p>
      </div>

      <ProfileForm
        initial={{
          username: profile.username,
          displayName: profile.displayName ?? '',
          bio: profile.profile?.bio ?? '',
          city: profile.city ?? '',
          githubUsername: profile.profile?.githubUsername ?? '',
          twitterHandle: profile.profile?.twitterHandle ?? '',
          websiteUrl: profile.profile?.websiteUrl ?? '',
        }}
      />
    </div>
  );
}
