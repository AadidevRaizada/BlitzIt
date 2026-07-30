import {
  getCurrentUser,
  canAccessTestEnvironment,
  isAdmin,
} from '@/server/modules/auth';
import { getPlatformSettings } from '@/server/modules/admin/settings';
import { countUnreadNotifications } from '@/server/modules/notification';
import { ProductShell } from '@/components/features/product-shell';

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const [unread, settings] = await Promise.all([
    user ? countUnreadNotifications(user.id) : Promise.resolve(0),
    getPlatformSettings(),
  ]);

  return (
    <ProductShell
      surface="broadcast"
      footer
      communityHref={settings.communityWhatsAppUrl}
      user={
        user
          ? {
              username: user.username,
              profileHref: `/u/${user.username}`,
              unread,
              isAdmin: isAdmin(user),
              canAccessTest: canAccessTestEnvironment(user),
            }
          : null
      }
    >
      {children}
    </ProductShell>
  );
}
