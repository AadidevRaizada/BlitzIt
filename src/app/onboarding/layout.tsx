import { Wordmark } from '@/components/ui/wordmark';

/**
 * The onboarding frame.
 *
 * Deliberately NOT `ProductShell`. Onboarding is the one moment where the
 * application chrome is actively harmful: the sidebar advertises Tournaments,
 * Leaderboard and Mission Control, none of which this person can use yet, and
 * every one of them is an invitation to leave before finishing. A nav bar is
 * useful when there is somewhere to go; here there is exactly one thing to do.
 *
 * So: no sidebar, no nav, no footer, no notification bell, no theme toggle.
 * A wordmark for orientation and nothing else. The only affordance on the
 * screen is the one that moves the person forward.
 *
 * `[data-surface="workspace"]` keeps the dark product palette rather than
 * following the OS theme, so onboarding looks like the app the person is about
 * to enter instead of switching appearance halfway through the flow.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-surface="workspace"
      className="bg-background text-foreground flex min-h-screen flex-col"
    >
      {/*
        Not a nav: no links. It is a fixed point of reference so the person
        knows whose product they are setting up, and it is the reason the
        content below can be vertically centred without floating.
      */}
      <header className="flex justify-center px-6 pt-10 pb-2 sm:pt-14">
        <Wordmark className="text-foreground/70 h-6" />
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-16">
        {/*
          One column, ~560px. Wide enough that a display name never feels
          cramped, narrow enough that the eye never has to search for where the
          next thing is.
        */}
        <div className="w-full max-w-[560px] pt-10 sm:pt-16">{children}</div>
      </main>
    </div>
  );
}
