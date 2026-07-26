'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="space-y-3 p-6" role="alert">
        <h1 className="text-xl font-semibold">Workspace failed to load</h1>
        <p className="text-muted-foreground text-sm">
          The request did not complete. Retry before changing anything else.
        </p>
        <Button onClick={reset} variant="primary">
          Retry
        </Button>
      </Card>
    </div>
  );
}
