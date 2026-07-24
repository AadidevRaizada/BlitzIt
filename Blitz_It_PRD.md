# Blitz It -- Product Requirements Document (PRD)

## Project

**Blitz It** *(Working Title)*

**Tagline:**\
\> **15 Minutes. One Shot. Just Ship.**

------------------------------------------------------------------------

# 1. Vision

Blitz It is a competitive AI-native coding esport.

Unlike traditional hackathons that reward endurance over 24--48 hours,
Blitz It rewards developers who can rapidly understand a problem,
leverage AI tools effectively, make sound engineering decisions, and
ship a working solution under extreme time pressure.

The experience should feel closer to **Blitz Chess, Valorant, or CS2**
than a hackathon.

------------------------------------------------------------------------

# 2. Objectives

## Business

-   Build a recurring weekly competition.
-   Grow a community around competitive AI development.
-   Generate highly shareable developer content.
-   Create sponsorship opportunities with AI tooling companies.
-   Keep operational overhead extremely low.

## User

Participants should feel: - Competition - Pressure - Excitement -
Achievement - Continuous improvement

------------------------------------------------------------------------

# 3. Target Audience

## Primary

-   Computer science students
-   Indie hackers
-   Startup founders
-   Full-stack developers
-   AI engineers

## Secondary

-   Spectators
-   Recruiters
-   Tech enthusiasts
-   Future competitors

------------------------------------------------------------------------

# 4. Core Philosophy

> Nobody cares how fast you type.

> They care how fast you can ship.

Everything is allowed: - AI assistants - Documentation - GitHub - Stack
Overflow - Tutorials - Copy-paste

The only thing that matters is whether your submission works.

------------------------------------------------------------------------

# 5. Weekly Competition Flow

## Tuesday--Thursday

-   Registration opens
-   User signs in
-   Purchases Weekly Pass (₹100)

## Friday

-   Registration closes
-   Simulation rounds unlock

## Saturday

-   Users complete simulation rounds
-   AI scores submissions
-   Players are seeded into brackets

## Sunday

Main tournament: - Round of 32 - Round of 16 - Quarter Finals - Semi
Finals - Finals

Results announced immediately. Prize payouts processed the next day.

------------------------------------------------------------------------

# 6. User Journey

1.  Discover Blitz It via social media or communities.
2.  Visit landing page.
3.  Login using GitHub or Google.
4.  Purchase Weekly Pass.
5.  Complete simulation rounds.
6.  Receive ranking.
7.  Compete in knockout tournament.
8.  View results.
9.  Return the following week.

------------------------------------------------------------------------

# 7. Core Features

## Authentication

GitHub & Google OAuth.

## Weekly Tournament Pass

Razorpay-powered payment unlocking the week's experience.

## Tournament Dashboard

Schedule, countdown, rank, season progress.

## Simulation Arena

Timed qualification challenges.

## Live Knockout Arena

Head-to-head elimination rounds.

## Problem Delivery Engine

Reveals challenges simultaneously.

## Submission Portal

GitHub repository + deployment URL submission.

## AI Judge

Automated evaluation: - Hidden tests - Deployment - Performance -
Security - Reliability - Code quality

## Leaderboard

Live rankings by username, city, score and seed.

## Tournament Bracket

Visual knockout progression.

## Hall of Fame

Previous champions and top performers.

## Notifications

Match reminders, rankings and payouts.

------------------------------------------------------------------------

# 8. Spectator Experience (V1)

Operationally lightweight.

Platform shows: - Live leaderboard - Tournament bracket - Match status

Streaming: - Embedded YouTube livestream - Initially only Semi-finals
and Finals

Hosts discuss: - Architecture - AI workflows - Product decisions -
Future roadmap

No platform-native streaming or chat in V1.

------------------------------------------------------------------------

# 9. Judging

Fully AI-driven.

## Functional

-   Build success
-   Hidden test cases
-   Deployment validation
-   API correctness

## Technical

-   Performance
-   Reliability
-   Security

## Quality

-   Code organization
-   Documentation
-   UI polish (where applicable)

------------------------------------------------------------------------

# 10. Rules

Allowed: - Any AI model - Any IDE - Any documentation - Public GitHub
repositories - Tutorials - Copy-paste - MCP servers

Winning is about shipping, not memorization.

------------------------------------------------------------------------

# 11. Tech Stack

## Frontend

-   Next.js (App Router)
-   TypeScript
-   Tailwind CSS

## Backend

-   Next.js Route Handlers
-   Server Actions

## Database

-   PostgreSQL
-   Prisma ORM

## Infrastructure

-   Railway

## Authentication

-   Better Auth / NextAuth

## Payments

-   Razorpay

## Storage

-   Cloudflare R2 (optional)

## AI

-   OpenAI / Anthropic

## Emails

-   Resend

## Analytics

-   PostHog

------------------------------------------------------------------------

# 12. Admin Panel

-   Create tournaments
-   Upload problem statements
-   Start rounds
-   Monitor submissions
-   Review AI scores
-   Publish winners
-   Trigger payouts

------------------------------------------------------------------------

# 13. Non-Goals (V1)

Not included: - Integrated IDE - Collaborative coding - Native
livestreaming - Voice chat - Community chat - Sponsor marketplace -
Social feed

------------------------------------------------------------------------

# 14. Success Metrics

## Week One

-   100+ registrations
-   32 qualified competitors
-   Successful live event
-   Fully automated judging

## First Three Months

-   500+ weekly registrations
-   60% returning users
-   Growing livestream audience
-   First sponsor partnerships

------------------------------------------------------------------------

# 15. Long-Term Vision

Blitz It becomes the default competitive platform for AI-native software
engineering.

Developers don't just build---they compete, improve, represent their
city, climb leaderboards, and become recognized in a global esports
ecosystem for software engineering.
