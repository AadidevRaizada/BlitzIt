import {
  ProductFooter,
  ProductNav,
  type ProductNavUser,
} from '@/components/features/product-nav';
import { cn } from '@/lib/utils';

export function ProductShell({
  children,
  user,
  surface,
  footer = false,
  communityHref = null,
}: {
  children: React.ReactNode;
  user: ProductNavUser | null;
  surface: 'broadcast' | 'workspace';
  footer?: boolean;
  communityHref?: string | null;
}) {
  return (
    <div
      data-surface={surface}
      className={cn(
        'bg-background text-foreground min-h-screen',
        surface === 'workspace' && 'text-[0.875rem]',
      )}
    >
      <ProductNav user={user} communityHref={communityHref} />
      {/* 64px, matching the collapsed rail. The rail expands OVER this, so the
          page never reflows when it does. */}
      <div className="lg:pl-16">
        <main
          className={cn(surface === 'workspace' && 'px-4 py-4 sm:px-5 lg:px-6')}
        >
          {children}
        </main>
        {footer ? <ProductFooter communityHref={communityHref} /> : null}
      </div>
    </div>
  );
}
