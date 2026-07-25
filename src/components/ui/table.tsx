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
        'px-3 py-2 text-xs font-medium tracking-wide uppercase',
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

/** Consistent empty state for every list — never a bare blank panel. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border-border rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {hint ? (
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          {hint}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
