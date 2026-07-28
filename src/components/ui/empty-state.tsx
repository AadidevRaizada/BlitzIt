import { cn } from '@/lib/utils';

/**
 * EmptyState — deliberately quieter than a populated state.
 *
 * The product used to render "No X yet" as a large, centred, dashed-bordered
 * panel on every page, which made emptiness the loudest thing on the screen.
 * The read was "this whole product is a shell" rather than "nothing here yet,
 * but everything around it works".
 *
 * So: no dashed border, no heavy fill, small type, left-aligned by default,
 * and muted. It should be legible and skippable. If an empty state needs an
 * action, pass one — but it stays a quiet link-weight control, never a hero
 * button competing with the real primary action on the page.
 */
export function EmptyState({
  title,
  description,
  hint,
  action,
  className,
  align = 'start',
}: {
  title: string;
  description?: React.ReactNode;
  /**
   * Alias for `description`, kept because ~20 call sites already use it. New
   * code should prefer `description`.
   */
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** `center` only for a genuinely full-page void, e.g. a blank search. */
  align?: 'start' | 'center';
}) {
  const body = description ?? hint;

  return (
    <div
      className={cn(
        'text-muted-foreground py-6',
        align === 'center' && 'flex flex-col items-center py-10 text-center',
        className,
      )}
    >
      <p className="text-foreground/70 text-small font-medium">{title}</p>
      {body ? <p className="text-caption mt-1 max-w-prose">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
