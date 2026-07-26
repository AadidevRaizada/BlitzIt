import { Card } from '@/components/ui/card';

export default function AppLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="space-y-2">
        <div className="bg-muted h-7 w-48 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-80 max-w-full animate-pulse rounded-md" />
      </div>
      <Card className="space-y-3 p-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading workspace</span>
        <div className="bg-muted h-4 w-24 animate-pulse rounded-md" />
        <div className="bg-muted h-20 animate-pulse rounded-md" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="bg-muted h-16 animate-pulse rounded-md" />
          <div className="bg-muted h-16 animate-pulse rounded-md" />
          <div className="bg-muted h-16 animate-pulse rounded-md" />
        </div>
      </Card>
    </div>
  );
}
