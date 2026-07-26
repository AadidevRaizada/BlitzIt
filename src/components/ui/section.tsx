import { cn } from '@/lib/utils';

export function Section({
  className,
  contentClassName,
  children,
  bleed = false,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  contentClassName?: string;
  bleed?: boolean;
}) {
  return (
    <section
      className={cn(
        'border-hairline relative border-t py-14 sm:py-18 lg:py-20',
        bleed && 'bg-surface-deep',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'mx-auto w-full max-w-6xl px-4 sm:px-6',
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
