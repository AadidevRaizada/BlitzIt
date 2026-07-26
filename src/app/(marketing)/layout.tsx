import { getCurrentUser, isAdmin } from '@/server/modules/auth';
import { countUnreadNotifications } from '@/server/modules/notification';
import { ProductShell } from '@/components/features/product-shell';

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const unread = user ? await countUnreadNotifications(user.id) : 0;

  return (
    <ProductShell
      surface="broadcast"
      footer
      user={
        user
          ? {
              username: user.username,
              profileHref: `/u/${user.username}`,
              unread,
              isAdmin: isAdmin(user),
            }
          : null
      }
    >
      {children}
    </ProductShell>
  );
}
