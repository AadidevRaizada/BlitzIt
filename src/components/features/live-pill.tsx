import { Badge, LiveDot } from '@/components/ui/badge';

/**
 * The live/standby indicator.
 *
 * When live, this is the one place on a page allowed to pulse red. When it is
 * not live it drops to a quiet outline pill — a "Standby" that still glowed
 * would train people to ignore the glow.
 */
export function LivePill({ live, label }: { live: boolean; label?: string }) {
  if (!live) {
    return <Badge tone="outline">{label ?? 'Standby'}</Badge>;
  }

  return (
    <Badge tone="live">
      <LiveDot />
      {label ?? 'Live'}
    </Badge>
  );
}
