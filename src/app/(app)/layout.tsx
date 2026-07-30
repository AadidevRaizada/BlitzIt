import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser, isAdmin } from '@/server/modules/auth';
import { getPlatformSettings } from '@/server/modules/admin/settings';
import { countUnreadNotifications } from '@/server/modules/notification';
import { ProductShell } from '@/components/features/product-shell';

export const dynamic = 'force-dynamic';

/**
 * Guarded layout for the authenticated app. Every route in this group requires
 * a session; unauthenticated visitors are redirected to /login.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const pathname = (await headers()).get('x-pathname') ?? '';
  if (!user.onboardingCompletedAt && pathname !== '/settings') {
    redirect('/onboarding');
  }

  const [unread, settings] = await Promise.all([
    countUnreadNotifications(user.id),
    getPlatformSettings(),
  ]);

  return (
    <ProductShell
      surface="workspace"
      user={{
        username: user.username,
        profileHref: `/u/${user.username}`,
        unread,
        isAdmin: isAdmin(user),
      }}
      communityHref={settings.communityWhatsAppUrl}
    >
      {children}
    </ProductShell>
  );
}
