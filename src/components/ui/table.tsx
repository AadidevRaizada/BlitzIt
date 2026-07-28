import { cn } from '@/lib/utils';

/**
 * Table — dense, scannable, and horizontally scrollable inside its own
 * container so a wide table never makes the page scroll sideways.
 *
 * Semantic `<table>` markup throughout: screen readers get row/column context
 * for free, which a div grid would have to reconstruct with ARIA.
 */
export function TableShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'border-border overflow-x-auto rounded-lg border',
        className,
      )}
    >
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-muted text-muted-foreground">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  className,
  numeric = false,
}: {
  children: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'text-eyebrow px-3 py-2 font-medium uppercase',
        numeric && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-border divide-y">{children}</tbody>;
}

export function TR({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <tr className={cn('hover:bg-accent/30', className)}>{children}</tr>;
}

export function TD({
  children,
  className,
  numeric = false,
}: {
  children: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-top',
        numeric && 'text-right tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * Re-exported so the ~20 existing `from '@/components/ui/table'` imports keep
 * working. There is exactly one EmptyState implementation, in
 * `@/components/ui/empty-state` — this used to be a second, louder one (dashed
 * border, centred, `p-8`), which is why emptiness was the most prominent thing
 * on every page. New code should import from the canonical module.
 */
export { EmptyState } from '@/components/ui/empty-state';
