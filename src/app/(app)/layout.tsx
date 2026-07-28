import { requireUser, isAdmin } from '@/server/modules/auth';
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
  const unread = await countUnreadNotifications(user.id);

  return (
    <ProductShell
      surface="workspace"
      user={{
        username: user.username,
        profileHref: `/u/${user.username}`,
        unread,
        isAdmin: isAdmin(user),
      }}
    >
      {children}
    </ProductShell>
  );
}
