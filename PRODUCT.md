# Product

## Register

product

## Users

Blitz It serves three primary groups: competitors building off-platform solutions under tournament deadlines, organizers operating the weekly tournament, and spectators following results. The E5 surface is for organizers: they need to create tournaments, monitor registrations and submissions, drive lifecycle transitions, inspect evaluations, and intervene through audited controls.

## Product Purpose

Blitz It is a developer tournament platform where competitors submit a public GitHub repository and a live deployment URL. The platform runs black-box evaluation, produces auditable scores, seeds brackets, and advances tournaments from registration through completion. Success means an organizer can run the event through the product UI instead of scripts while preserving the domain boundaries and auditability established by earlier epics.

## Brand Personality

Premium, technical, calm. The app should feel like a fast operational console for serious developer competitions, not a game dashboard or marketing spectacle.

## Anti-references

Avoid gaming aesthetics, noisy gradients, decorative glassmorphism, dashboard fluff, large hero layouts inside admin surfaces, and UI that hides operational state behind decoration. Avoid duplicating domain rules in components.

## Design Principles

1. Operations first: show state, counts, timing, failures, and the next valid action clearly.
2. Domain boundaries are part of the UX: admin screens orchestrate modules, they do not reimplement lifecycle or evaluation logic.
3. Dense but readable: use compact tables, cards only where they frame actual records, and progressive disclosure for evidence and settings.
4. Auditable intervention: every destructive or exceptional admin action needs intent, confirmation, and a durable trail.
5. Calm urgency: use the purple and green accents for action and live state, never as decorative noise.

## Accessibility & Inclusion

Target WCAG AA contrast, keyboard-accessible navigation and forms, visible focus states, semantic labels, reduced motion by default in operational screens, and responsive layouts that remain usable on desktop and tablet.
