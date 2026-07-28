import { notFound } from 'next/navigation';
import { requireUser } from '@/server/modules/auth';
import { getEditableProfile } from '@/server/modules/auth/profile';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ProfileForm } from './profile-form';

export const metadata = { title: 'Settings - The Circuit' };

/** Profile edit screen for the signed-in user. */
export default async function SettingsPage() {
  const user = await requireUser('/settings');
  const profile = await getEditableProfile(user.id);
  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="Profile settings"
        description="This information appears on your public profile."
      />

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

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">Data export</h2>
        <p className="text-muted-foreground text-sm">
          Download your profile, registrations, submissions, payments and
          notifications as JSON.
        </p>
        <a
          href="/api/me/export"
          className="text-primary inline-flex text-sm font-medium underline"
        >
          Download my data
        </a>
      </Card>
    </div>
  );
}
