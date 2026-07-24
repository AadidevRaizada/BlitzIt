/**
 * Landing placeholder (Milestone 0). The real spectator experience (D10) —
 * live leaderboard, bracket, stream, prize pool, countdown — is built in
 * Epic E8. This is just a foundation smoke-screen.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="border-border bg-secondary text-secondary-foreground rounded-full border px-3 py-1 text-xs font-medium">
        Foundation · Milestone 0
      </span>
      <h1 className="from-primary to-accent-foreground bg-gradient-to-r bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-6xl">
        Blitz It
      </h1>
      <p className="text-muted-foreground max-w-md text-lg">
        15 Minutes. One Shot. Just Ship.
      </p>
      <p className="text-muted-foreground max-w-lg text-sm">
        The platform is under active construction. Follow the sprint plan in{' '}
        <code className="bg-muted rounded px-1.5 py-0.5">docs/</code>.
      </p>
    </main>
  );
}
