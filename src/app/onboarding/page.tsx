import { redirect } from 'next/navigation';
import { requireUser } from '@/server/modules/auth';
import { getOnboardingState } from '@/server/modules/auth/onboarding';
import { OnboardingFlow } from './onboarding-flow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome - The Circuit' };

/**
 * First-run setup.
 *
 * The guards are unchanged from the previous version — `requireUser`, then
 * redirect anyone already onboarded to their dashboard. Only the presentation
 * below it changed: the explanatory column and the application shell are gone,
 * because neither survived the question "what is this person deciding right
 * now?".
 */
export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  const state = await getOnboardingState(user.id);

  if (state.completed) redirect('/dashboard');

  return <OnboardingFlow initial={state} />;
}
