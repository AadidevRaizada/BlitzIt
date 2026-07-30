'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { completeOnboardingAction } from '@/server/actions/onboarding.actions';
import { authClient } from '@/lib/auth-client';
import { usernameSchema } from '@/lib/validation/profile.schema';
import type { Result } from '@/lib/errors';
import type { OnboardingState } from '@/server/modules/auth/onboarding';
import { GitHubIcon } from '@/components/ui/brand-icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * First-run setup, one decision per screen.
 *
 * ## What this does NOT change
 *
 * Nothing behind the presentation. The Server Action, its `FormData` contract
 * (`displayName`, `username`, `city`, `termsAccepted`), `onboardingSchema`, the
 * GitHub linking call and the completion logic are all untouched. The whole of
 * this file is a different way of asking the same four questions.
 *
 * The client-side checks below are the SAME schema the action validates with,
 * imported rather than restated — `usernameSchema` is the real one. They only
 * decide whether `Continue` is enabled; the server remains the authority and
 * still re-validates everything.
 *
 * ## Why one form, and why the visible inputs are unnamed
 *
 * The action takes all four fields at once, so the steps cannot each submit.
 * Everything is held in React state and written into hidden inputs, which are
 * what `FormData` actually reads. The visible input on each step deliberately
 * has no `name`: if it did, its value would land in `FormData` twice and the
 * step's transient state would compete with the committed one.
 *
 * `termsAccepted` is serialised as the string `"on"` because that is precisely
 * what `completeOnboardingAction` compares against. Changing that comparison
 * would have been a backend change.
 */

type ActionState = Result<{ username: string }> | null;

/** Where the person is. 0 is welcome, 6 is success; 1–5 are the questions. */
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The five numbered steps, for the "Step N of 6" label the spec asks for. */
const TOTAL_STEPS = 6;

/**
 * In-progress answers, kept across the GitHub round trip.
 *
 * Linking GitHub is a full navigation to github.com and back, which throws away
 * every unsaved value in the page. The old single-page form had the same
 * problem and solved it by accident — the fields were empty anyway, because
 * nothing was saved until the very end. A stepped flow makes the loss obvious
 * and infuriating: you answer three questions, connect GitHub, and come back to
 * a blank first step.
 *
 * `sessionStorage`, not `localStorage`: this is scratch state for one sitting,
 * it contains a display name and a city, and it should not outlive the tab.
 */
const DRAFT_KEY = 'circuit:onboarding-draft:v1';

interface Draft {
  displayName: string;
  username: string;
  city: string;
  termsAccepted: boolean;
  step: StepIndex;
}

function readDraft(): Partial<Draft> | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
  } catch {
    // Private mode, disabled storage, or corrupt JSON. Losing the draft is a
    // nuisance; throwing here would break onboarding entirely.
    return null;
  }
}

function writeDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Ignored for the same reason.
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignored for the same reason.
  }
}

export function OnboardingFlow({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    completeOnboardingAction,
    null,
  );

  const [displayName, setDisplayName] = useState(initial.profile.displayName);
  const [username, setUsername] = useState(initial.profile.username);
  const [city, setCity] = useState(initial.profile.city);
  const [termsAccepted, setTermsAccepted] = useState(initial.termsAccepted);
  const [step, setStep] = useState<StepIndex>(0);
  const [linking, setLinking] = useState(false);

  // The draft can only be read after mount — reading storage during render
  // would disagree with the server-rendered HTML and break hydration. So the
  // first paint is deliberately empty and the flow fades in once the real
  // starting step is known. One frame of calm space beats a frame of the wrong
  // question, which is exactly what someone returning from GitHub would see.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      if (draft.displayName) setDisplayName(draft.displayName);
      if (draft.username) setUsername(draft.username);
      if (draft.city) setCity(draft.city);
      if (draft.termsAccepted) setTermsAccepted(true);
    }

    // Coming back from GitHub is the case worth getting right: the person left
    // on step 4 and the account is now linked, so they should land on the step
    // AFTER it rather than being made to press Continue on a question that has
    // already answered itself.
    const savedStep = draft?.step;
    if (initial.githubLinked && savedStep === 4) {
      setStep(5);
    } else if (typeof savedStep === 'number') {
      setStep(savedStep as StepIndex);
    } else if (initial.githubLinked) {
      // A returning session with no draft (new tab, storage cleared). GitHub is
      // already done, so skip the welcome and start asking questions.
      setStep(1);
    }

    setReady(true);
  }, [initial.githubLinked]);

  // Persist after every change, so the draft is current whenever the person
  // leaves for GitHub. Skipped until `ready` so the empty pre-hydration state
  // cannot overwrite a real draft.
  useEffect(() => {
    if (!ready) return;
    writeDraft({ displayName, username, city, termsAccepted, step });
  }, [ready, displayName, username, city, termsAccepted, step]);

  // ---- Validation. The same rules the action enforces, used only to gate the
  // button. Nothing here relaxes or replaces the server's check. ----

  const trimmedDisplayName = displayName.trim();
  const trimmedCity = city.trim();
  const usernameCheck = usernameSchema.safeParse(username);

  const displayNameValid =
    trimmedDisplayName.length >= 1 && trimmedDisplayName.length <= 50;
  const cityValid = trimmedCity.length >= 1 && trimmedCity.length <= 80;
  const usernameValid = usernameCheck.success;

  const stepValid: Record<StepIndex, boolean> = {
    0: true,
    1: displayNameValid,
    2: usernameValid,
    3: cityValid,
    4: initial.githubLinked,
    5: termsAccepted,
    6: true,
  };

  const canContinue = stepValid[step];

  /** The earliest step whose answer is not acceptable — where to send someone back to. */
  const firstInvalidStep = useCallback((): StepIndex => {
    if (!displayNameValid) return 1;
    if (!usernameValid) return 2;
    if (!cityValid) return 3;
    if (!initial.githubLinked) return 4;
    if (!termsAccepted) return 5;
    return 5;
  }, [
    displayNameValid,
    usernameValid,
    cityValid,
    initial.githubLinked,
    termsAccepted,
  ]);

  // ---- Result handling ----

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      clearDraft();
      setStep(6);
      // Refresh so the session and any shell state reflect a completed profile
      // before the person moves on. The navigation itself is theirs to make —
      // the success screen is part of the flow, not a redirect target.
      router.refresh();
    } else {
      // A rejected submission must land the person ON the question that was
      // wrong. The previous form could only toast, because every field was on
      // screen; here, leaving them on the rules step with a message about their
      // username would be a dead end. `CONFLICT` is the taken-username case.
      const target = state.error.code === 'CONFLICT' ? 2 : firstInvalidStep();
      setStep(target);
      toast.error(state.error.message);
    }
  }, [state, router, firstInvalidStep]);

  // ---- Focus. After every transition the caret belongs in the next answer. ----

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    const node =
      panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    // `preventScroll` because the panel is already centred; letting the browser
    // scroll to it shifts a page that did not need moving.
    node?.focus({ preventScroll: true });
  }, [step, ready]);

  function goNext() {
    if (!canContinue) return;
    setStep((current) => Math.min(current + 1, 6) as StepIndex);
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 0) as StepIndex);
  }

  async function linkGitHub() {
    setLinking(true);
    // Written synchronously before navigating away: the persistence effect
    // above runs on a React commit, and this handler leaves the page.
    writeDraft({ displayName, username, city, termsAccepted, step: 4 });
    try {
      await authClient.linkSocial({
        provider: 'github',
        callbackURL: '/onboarding',
      });
    } catch {
      toast.error('Could not start GitHub linking. Please try again.');
      setLinking(false);
    }
  }

  /**
   * Enter advances, except where it would submit prematurely.
   *
   * The whole flow is one `<form>`, so an unguarded Enter on step 1 would fire
   * the action with three empty fields. Only the final question is allowed to
   * submit, and only when it is answered.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter') return;
    // Let a deliberate press on the GitHub button do its own thing.
    if ((event.target as HTMLElement).tagName === 'BUTTON') return;

    if (step === 5) {
      if (!canContinue) event.preventDefault();
      return;
    }
    event.preventDefault();
    goNext();
  }

  return (
    <form
      action={formAction}
      onKeyDown={onKeyDown}
      className={cn(
        'transition-opacity duration-[var(--motion-base)]',
        ready ? 'opacity-100' : 'opacity-0',
      )}
    >
      {/* What FormData actually carries. The visible inputs are unnamed. */}
      <input type="hidden" name="displayName" value={displayName} />
      <input type="hidden" name="username" value={username} />
      <input type="hidden" name="city" value={city} />
      {termsAccepted ? (
        <input type="hidden" name="termsAccepted" value="on" />
      ) : null}

      {/*
        Reserves the vertical space the tallest step needs, so Continue does not
        walk up and down the screen between questions. A control that moves
        under the cursor is the cheapest possible way to feel unfinished.
      */}
      <div ref={panelRef} className="min-h-[22rem]">
        {/*
          Keyed on the step so React remounts the panel, which is what restarts
          the entrance animation. `rise` is the existing token — a fade plus a
          10px lift — rather than a new keyframe invented for this screen.
          `motion-safe:` keeps the movement off for anyone who asked for less of
          it; the global reduced-motion rule in globals.css already flattens
          every duration as a second line of defence.
        */}
        <div key={step} className="motion-safe:animate-rise">
          <StepBody
            step={step}
            state={{
              displayName,
              username,
              city,
              termsAccepted,
              linking,
              githubLinked: initial.githubLinked,
              githubUsername: initial.profile.githubUsername,
              usernameError:
                username.length > 0 && !usernameValid
                  ? (usernameCheck.error?.issues[0]?.message ?? null)
                  : null,
              usernameValid,
            }}
            on={{
              setDisplayName,
              setUsername,
              setCity,
              setTermsAccepted,
              linkGitHub,
            }}
          />
        </div>
      </div>

      <Actions
        step={step}
        pending={pending}
        canContinue={canContinue}
        onNext={goNext}
        onBack={goBack}
      />
    </form>
  );
}

// ───────────────────────────── Steps ─────────────────────────────

interface StepState {
  displayName: string;
  username: string;
  city: string;
  termsAccepted: boolean;
  linking: boolean;
  githubLinked: boolean;
  githubUsername: string | null;
  usernameError: string | null;
  usernameValid: boolean;
}

interface StepHandlers {
  setDisplayName: (value: string) => void;
  setUsername: (value: string) => void;
  setCity: (value: string) => void;
  setTermsAccepted: (value: boolean) => void;
  linkGitHub: () => void;
}

function StepBody({
  step,
  state,
  on,
}: {
  step: StepIndex;
  state: StepState;
  on: StepHandlers;
}) {
  switch (step) {
    case 0:
      return (
        <Screen
          headline="Welcome to The Circuit."
          sub="Let's get you ready for your first competition."
          note="This takes about 30 seconds."
        />
      );

    case 1:
      return (
        <Screen
          eyebrow={`Step 1 of ${TOTAL_STEPS}`}
          headline="What should competitors call you?"
        >
          <Field
            label="Display name"
            value={state.displayName}
            onChange={on.setDisplayName}
            placeholder="Ada Lovelace"
            autoComplete="name"
            maxLength={50}
          />
        </Screen>
      );

    case 2:
      return (
        <Screen
          eyebrow={`Step 2 of ${TOTAL_STEPS}`}
          headline="Choose your username."
        >
          <Field
            label="Username"
            value={state.username}
            // Lowercased as they type rather than rejected afterwards: the rule
            // is lowercase-only, so silently honouring it is kinder than an
            // error message about a capital letter they did not mean.
            onChange={(value) => on.setUsername(value.toLowerCase())}
            placeholder="ada"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={24}
            prefix="circuit.devhub.wtf/u/"
          />
          <Hint
            tone={
              state.usernameError
                ? 'error'
                : state.usernameValid
                  ? 'ok'
                  : 'muted'
            }
          >
            {state.usernameError ??
              (state.usernameValid
                ? 'Looks good'
                : '3–24 characters. Lowercase letters, numbers and hyphens.')}
          </Hint>
        </Screen>
      );

    case 3:
      return (
        <Screen
          eyebrow={`Step 3 of ${TOTAL_STEPS}`}
          headline="Where are you competing from?"
        >
          <Field
            label="City"
            value={state.city}
            onChange={on.setCity}
            placeholder="Mumbai"
            // The browser's own saved addresses are the only autocomplete
            // available without adding a place-lookup service, which would be a
            // backend change.
            autoComplete="address-level2"
            maxLength={80}
          />
        </Screen>
      );

    case 4:
      return (
        <Screen
          eyebrow={`Step 4 of ${TOTAL_STEPS}`}
          headline="Connect the GitHub account you'll submit from."
          sub="We'll only read your public repositories."
        >
          {state.githubLinked ? (
            <div className="border-success/30 bg-success/10 flex items-center gap-3 rounded-xl border px-4 py-3.5">
              <Check className="text-success size-5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-success text-sm font-semibold">Connected</p>
                {state.githubUsername ? (
                  <p className="text-muted-foreground truncate text-sm">
                    github.com/{state.githubUsername}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full justify-center"
              onClick={on.linkGitHub}
              disabled={state.linking}
              aria-busy={state.linking}
              data-autofocus
            >
              {state.linking ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <GitHubIcon className="size-4" />
              )}
              Connect GitHub
            </Button>
          )}
        </Screen>
      );

    case 5:
      return (
        <Screen
          eyebrow={`Step 5 of ${TOTAL_STEPS}`}
          headline="Almost done."
          sub="Please accept the competition rules."
        >
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5',
              'transition-colors duration-[var(--motion-fast)]',
              state.termsAccepted
                ? 'border-primary/40 bg-primary/5'
                : 'border-border hover:border-primary/30',
            )}
          >
            <input
              type="checkbox"
              checked={state.termsAccepted}
              onChange={(event) => on.setTermsAccepted(event.target.checked)}
              data-autofocus
              className="accent-primary mt-0.5 size-4 shrink-0"
            />
            <span className="text-sm leading-6">
              I accept the{' '}
              <a
                href="/rules"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                competition rules
              </a>{' '}
              and{' '}
              <a
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                terms
              </a>
              .
            </span>
          </label>
        </Screen>
      );

    case 6:
      return (
        <Screen
          headline="You're ready."
          sub="Welcome to The Circuit."
          icon={
            <div className="bg-success/15 mb-7 flex size-14 items-center justify-center rounded-full">
              <Check className="text-success size-7" aria-hidden />
            </div>
          }
        />
      );
  }
}

// ───────────────────────────── Presentation ─────────────────────────────

/**
 * One headline, one question, one action.
 *
 * The eyebrow, headline and sub are the only text allowed on a step. Everything
 * the old page explained in a paragraph is either obvious from the question or
 * was not being read.
 */
function Screen({
  eyebrow,
  headline,
  sub,
  note,
  icon,
  children,
}: {
  eyebrow?: string;
  headline: string;
  sub?: string;
  note?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      {icon}
      {eyebrow ? (
        <p className="text-muted-foreground mb-5 text-xs font-medium tracking-[0.14em] uppercase tabular-nums">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="font-display text-wrap-balance text-3xl leading-[1.15] font-bold sm:text-[2.5rem]">
        {headline}
      </h1>
      {sub ? (
        <p className="text-muted-foreground mt-4 text-lg leading-8">{sub}</p>
      ) : null}
      {note ? (
        <p className="text-muted-foreground/70 mt-2 text-sm">{note}</p>
      ) : null}
      {children ? <div className="mt-9 space-y-3">{children}</div> : null}
    </div>
  );
}

/**
 * A single large input.
 *
 * Not `TextField` from the UI kit: that is a compact admin control with its
 * label stacked above at 12px, correct in a settings table and wrong as the one
 * object on a screen. The label here is visually hidden — the headline above it
 * already asks the question, so repeating it would be the duplicated
 * description this redesign exists to remove — but it stays in the accessibility
 * tree for anyone not reading the headline visually.
 */
function Field({
  label,
  value,
  onChange,
  prefix,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'className'
>) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <span
        className={cn(
          'border-border bg-surface-raised flex items-center rounded-xl border',
          'focus-within:border-primary/60 focus-within:ring-primary/20 focus-within:ring-2',
          'transition-colors duration-[var(--motion-fast)]',
        )}
      >
        {prefix ? (
          <span className="text-muted-foreground/60 hidden shrink-0 py-4 pl-4 text-base sm:block">
            {prefix}
          </span>
        ) : null}
        <input
          {...props}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-autofocus
          className={cn(
            'w-full bg-transparent py-4 text-base outline-none',
            'placeholder:text-muted-foreground/40',
            prefix ? 'pr-4 pl-4 sm:pl-0' : 'px-4',
          )}
        />
      </span>
    </label>
  );
}

function Hint({
  tone,
  children,
}: {
  tone: 'ok' | 'error' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <p
      // Announced politely so a screen-reader user hears the username verdict
      // without it interrupting their typing.
      aria-live="polite"
      className={cn(
        'flex items-center gap-1.5 text-sm',
        tone === 'ok' && 'text-success',
        tone === 'error' && 'text-destructive',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      {tone === 'ok' ? <Check className="size-4" aria-hidden /> : null}
      {children}
    </p>
  );
}

/**
 * The single call to action, plus the two quiet affordances around it.
 *
 * Back is a text link rather than a button: going back is a repair, not a
 * choice being offered, and giving it equal weight would put two decisions on a
 * screen that is meant to hold one.
 */
function Actions({
  step,
  pending,
  canContinue,
  onNext,
  onBack,
}: {
  step: StepIndex;
  pending: boolean;
  canContinue: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  if (step === 6) {
    return (
      <div className="mt-10">
        {/*
          An anchor rather than a Button: `Button` renders a real <button> and
          has no `asChild`, and this is a navigation. A full document load is
          also the right choice here — the shell has to rebuild now that the
          person has a completed profile.
        */}
        <a
          href="/dashboard"
          data-autofocus
          className={cn(
            buttonVariants({ variant: 'broadcast', size: 'lg' }),
            'w-full justify-center sm:w-auto',
          )}
        >
          Enter Mission Control
          <ArrowRight className="size-4" aria-hidden />
        </a>
      </div>
    );
  }

  const isFinal = step === 5;

  return (
    <div className="mt-10 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          // Only the last step submits; the rest advance in place, which is
          // what keeps the whole flow free of page reloads.
          type={isFinal ? 'submit' : 'button'}
          onClick={isFinal ? undefined : onNext}
          variant="broadcast"
          size="lg"
          disabled={!canContinue || pending}
          aria-busy={pending}
          className="w-full justify-center sm:w-auto sm:min-w-[11rem]"
          {...(step === 0 ? { 'data-autofocus': true } : {})}
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finishing
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="size-4" aria-hidden />
            </>
          )}
        </Button>

        {step > 0 ? (
          <button
            type="button"
            onClick={onBack}
            className={cn(
              'text-muted-foreground hover:text-foreground text-sm',
              'focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none',
              'transition-colors duration-[var(--motion-fast)]',
            )}
          >
            Back
          </button>
        ) : null}
      </div>

      <Progress step={step} />
    </div>
  );
}

/** ● ○ ○ ○ ○ — position without a number, for the steps that have one. */
function Progress({ step }: { step: StepIndex }) {
  if (step === 0) return null;

  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
      aria-valuenow={step}
      aria-label={`Step ${step} of ${TOTAL_STEPS}`}
    >
      {[1, 2, 3, 4, 5].map((index) => (
        <span
          key={index}
          className={cn(
            'h-1 rounded-full transition-all duration-[var(--motion-base)]',
            index === step
              ? 'bg-primary w-7'
              : index < step
                ? 'bg-primary/40 w-4'
                : 'bg-border w-4',
          )}
        />
      ))}
    </div>
  );
}
