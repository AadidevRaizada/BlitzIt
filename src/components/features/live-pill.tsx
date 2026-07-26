import { Badge } from '@/components/ui/badge';

export function LivePill({ live, label }: { live: boolean; label?: string }) {
  if (!live) {
    return <Badge tone="outline">{label ?? 'Standby'}</Badge>;
  }

  return <Badge tone="live">{label ?? 'Live'}</Badge>;
}
