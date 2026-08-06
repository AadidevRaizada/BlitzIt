import { redirect } from 'next/navigation';
import {
  canAccessTestEnvironment,
  isAdmin,
  requireUser,
} from '@/server/modules/auth';
import { getPlatformSettings } from '@/server/modules/admin/settings';
import { getOnboardingState } from '@/server/modules/auth/onboarding';
import { ProductShell } from '@/components/features/product-shell';
import { OnboardingForm } from './onboarding-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Onboarding - The Circuit' };

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  const [state, settings] = await Promise.all([
    getOnboardingState(user.id),
    getPlatformSettings(),
  ]);

  if (state.completed && state.profile.city) redirect('/dashboard');

  return (
    <ProductShell
      surface="workspace"
      communityHref={settings.communityWhatsAppUrl}
      user={{
        username: user.username,
        profileHref: `/u/${user.username}`,
        unread: 0,
        isAdmin: isAdmin(user),
        canAccessTest: canAccessTestEnvironment(user),
      }}
    >
      <div className="mx-auto grid max-w-5xl gap-6 py-6 lg:grid-cols-[0.8fr_1.2fr]">
        {state.completed && !state.profile.city && (
          <div className="border-hairline bg-surface-raised col-span-full border p-4 text-sm font-medium text-amber-500">
            👋 Welcome back! We now require a <strong>City</strong> to sort the
            leaderboards. Please update your city below to complete your setup.
          </div>
        )}

        <div className="space-y-3">
          <p className="text-primary text-sm font-medium">First run setup</p>
          <h1 className="font-display text-wrap-balance text-3xl font-bold">
            Set up your competitor identity
          </h1>
          <p className="text-muted-foreground max-w-prose leading-7">
            The Circuit needs your public profile, linked GitHub account, and
            current terms acceptance before tournament registration.
          </p>
        </div>

        <OnboardingForm initial={state} />
      </div>
    </ProductShell>
  );
}
