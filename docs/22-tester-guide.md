# Tester guide — what to do when you arrive

For people testing BlitzIt end to end. Written to be handed over as-is.

Live site: **https://circuit.devhub.wtf**

---

## 1. What you are being asked to do

BlitzIt is a competitive programming league where the thing being judged is
**software that runs**, not code on a page. You get a spec, you build a REST API,
you deploy it, and you submit the URL. An automated judge then sends hidden HTTP
requests at your deployment and scores what it finds.

**Using AI to write it is expected, not cheating.** The challenges are designed so
that the model writes the endpoint easily and the marks are in the rules it
usually gets wrong. Read the spec twice; that is the actual game.

You need, before you start:

- A **GitHub account** (or Google) — those are the only two sign-in options; there
  is no email-and-password.
- Somewhere to **deploy a web service in a few minutes** — Railway, Render, Fly,
  Vercel, Deno Deploy, whatever you already know. Free tiers are fine.
- A **public GitHub repository** for the code.

---

## 1b. If you have been given a TEST account

Most testers are given a **TEST account**, which competes in the internal test
environment rather than in the live league. Everything below still applies
unchanged — you onboard, connect GitHub, register, submit and appear in brackets
exactly like a real competitor, because it is the same product. Three things
differ, and only three:

- Your tournaments live under **Test environment** in the account menu. A yellow
  banner sits above every page there so you always know which world you are in.
- Your results stay there. They never reach the public leaderboard, rankings,
  statistics, Hall of Fame or your public profile — so you can lose badly in a
  rehearsal without it following you around.
- Your field may include **bots**, shown with a `BOT` badge beside their name.
  They are synthetic competitors that fill the bracket so a tournament can run
  with fewer than eight real people. They submit and score like anyone else; you
  play them normally.

You cannot enter production tournaments from a TEST account, and a production
account cannot see test ones. If you need to do both, ask for two accounts.

If you were given an ordinary account, ignore this section entirely.

---

## 2. Sign in and set up your profile

1. Go to https://circuit.devhub.wtf and press **Register** (or **Log in**).
2. Choose **GitHub** or **Google**. Signing in with either creates your account
   on first use.
   - If you sign in with Google using the same email you used with GitHub, you get
     the **same** account, not a second one. Worth testing deliberately.
3. Fill in your profile: display name, username, and your GitHub username.

**What to report:** anything about this flow that is confusing, any error page you
land on, and whether the account-linking behaviour above actually holds.

---

## 3. Register for the tournament

The home page shows the current tournament, its status, and a countdown.

- **REGISTRATION OPEN** → the **Register** button works.
- Anything else → registration is closed and the button should tell you so rather
  than failing when you press it.

If the tournament has an entry fee you will be taken through Razorpay. If it is
free you are registered immediately. Either way you should get a **confirmation
email**.

**What to report:** the countdown disagreeing with the status; a Register button
that appears when registration is not actually open; no confirmation email.

### If the tournament gets cancelled

A tournament that does not attract its minimum number of competitors by the time
registration closes **cancels itself**. If that happens you should:

1. Get an email saying it was cancelled and why.
2. Be **refunded automatically** if you paid — you do not have to ask.
3. See the tournament disappear from the public list about a day later.

This is intended behaviour, not a fault. It is worth testing on purpose: register
alone for a tournament whose minimum is higher than 1, let registration close,
and check you get the email and the refund.

---

## 4. Understand the schedule

Every tournament runs the same shape, and every step fires off its own clock with
nobody pressing anything:

```
Registration opens → Registration closes
   → Qualifiers (3 rounds: 30 min, 20 min, 10 min)
   → Seeding
   → Knockout bracket → Final
```

- **Qualifiers** are three timed rounds. Everyone gets the same challenge at the
  same moment; your scores across the three decide your seed.
- **Knockout** is head-to-head. Win your match, advance.

The challenge statement is **sealed until the round opens.** You cannot see it
early, and neither can anyone else.

---

## 5. During a round

When a round opens:

1. The challenge statement appears. **Read all of it, including the validation
   and edge-case sections** — that is where most of the marks are.
2. Build the API. Use whatever language and framework you like.
3. Deploy it somewhere publicly reachable over **HTTPS**.
4. Push the code to a **public** GitHub repo.
5. Submit **two URLs**:
   - your **repository URL**
   - your **deployment URL** (the base URL — the judge appends the paths itself)

Then the round closes on its deadline and the judge runs.

### Hard rules worth knowing before you lose marks to them

- **The deadline is the server's, not your laptop's.** A submission that arrives
  after the round closes is refused.
- **Your deployment URL must be unique to you within a round.** Two competitors
  cannot submit the same URL.
- **Implement `GET /health` returning `{"status":"ok"}` on every challenge.** It
  is sampled repeatedly for your performance score. Keep it trivial — no database
  calls in it.
- **`GET /` must not return a 5xx and must not leak a stack trace.** It is
  probed for the security score.
- **Remove the `X-Powered-By` header.** Most frameworks add it for you and it is
  a deduction. Express: `app.disable('x-powered-by')`.
- Send **`Content-Type: application/json`** on every JSON response.
- Turn unhandled errors into a clean JSON `400`/`500`, never a crash.

---

## 6. Stateful challenges

Qualifier challenges are pure functions: request in, response out, nothing
remembered. **Knockout challenges are stateful** — the judge sends a sequence and
checks how your API managed what the earlier requests created.

For those:

- **Store state however you like.** An in-memory object is a legitimate answer.
  SQLite, Postgres and Redis are equally fine. Nothing is pre-loaded and you never
  need to run a migration.
- **You must implement `POST /_reset`**, which clears everything and returns
  `{"ok": true}`. The judge calls it first, and may replay the whole sequence, so
  your API has to be able to start clean on demand.
- **All ids come from the request.** You never generate one. Re-sending a create
  with an id that already exists is an idempotent no-op that returns the existing
  record — not a duplicate and not an error.
- Requests arrive **one at a time, in order**. You are not being graded on
  concurrency.

One caution worth knowing: if you deploy to a platform that runs **several
instances** and you keep state in memory, consecutive requests can land on
different instances and your state will appear to vanish. Either keep it to a
single instance or use real storage.

---

## 7. How you are scored

| Dimension | Weight | What it is |
|---|---|---|
| Functional | 60% | Hidden HTTP tests against your deployment |
| Performance | 15% | p95 latency of `GET /health` |
| Security & reliability | 10% | HTTPS, security headers, no 5xx, no leaked stack traces |
| AI review | 15% | Code organisation, documentation, engineering judgement |

The **AI review only runs from the semi-finals onward.** Earlier rounds are scored
purely on the deterministic dimensions.

Your code is read as **text** through the GitHub API. Nothing is ever cloned,
built or executed on our infrastructure.

After a round you can see your score and the evidence behind it under your
results — including which hidden tests passed.

---

## 8. What to actually test, and what to report

Work through this list and report anything that does not behave as described.

**Accounts**
- [ ] Sign in with GitHub. Sign out. Sign in again.
- [ ] Sign in with Google on the same email — you should land on the same account.
- [ ] Edit your profile and confirm it persists.

**Registration**
- [ ] Register for an open tournament; confirm the email arrives.
- [ ] Try to register twice — the second attempt should be refused cleanly.
- [ ] Withdraw, then re-register.
- [ ] Try to register when registration is closed.

**Rounds and submissions**
- [ ] Confirm the statement is not visible before the round opens.
- [ ] Submit a working deployment; confirm you get a score and per-test evidence.
- [ ] Submit a deliberately broken deployment; confirm you are scored, not
      crashed, and the failing tests are named.
- [ ] Submit a URL that is not reachable at all; confirm the failure is explained.
- [ ] Try to submit after the deadline; confirm refusal.
- [ ] Submit again before the deadline; confirm which submission counts.

**Spectator surfaces**
- [ ] Watch the live page during a round — does the countdown match reality?
- [ ] Check the leaderboard and Hall of Fame after a tournament completes.

**Cancellation**
- [ ] Let an under-subscribed tournament close; confirm the email, the refund if
      paid, and that it eventually disappears from the public list.

**When you report something, include:** the page URL, the time (with timezone),
what you expected, what happened, and your username. A screenshot of the whole
window beats a cropped one — the surrounding state is usually the clue.

---

## 9. Things that are known and are not bugs

- **The AI review is absent in early rounds.** By design (see D20).
- **A tournament can sit still for a few minutes.** Progression is checked on a
  30-second sweep and some steps wait for evaluations to drain. If it sits still
  for much longer than that, report it.
- **Only REST API challenges exist right now.** Web apps, CLIs, agents and the
  rest are planned but not enabled.
- **Concurrency is not tested this week.** Your API will never receive two
  overlapping requests from the judge.
- **A cancelled tournament never reopens.** That is deliberate; a new tournament
  is created instead.
