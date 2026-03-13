# Zero-Person Indie R&D Team — Release / PR Summary

Date: 2026-03-13  
Author: Codex  
Repo: `paperclip`

## 1. Executive summary

This change turns the current Paperclip V1 implementation target into a much more opinionated **zero-person indie R&D operating mode**:

- one-click bootstrap for a PM / Dev / Tester / Marketing team
- a company-scoped funnel from `discover -> validate -> build -> launch -> growth`
- first-class **social signals** as market-input objects
- reusable **X / Reddit ingestion sources**
- scheduled source sync, rules/LLM scoring, auto-promotion, and launch/growth auto-kickoff
- dashboard and onboarding UX that expose the new operating model directly

In maintainer terms, this PR is not a cosmetic feature pass. It adds a new default product story while still reusing existing Paperclip control-plane primitives: `companies`, `goals`, `projects`, `issues`, `agents`, `heartbeat`, and `activity_log`.

**Recommendation:** merge as a coordinated product-scope PR.  
Reason: the branch is now coherent end-to-end, contract-synchronized across db/shared/server/ui, and verification passes (`pnpm -r typecheck`, `pnpm build`, targeted tests).

---

## 2. What this PR actually adds

### 2.1 New operating model

Paperclip now explicitly supports a `zero_person_rd` company mode backed by:

- company metadata + blueprint state
- seeded PM / Engineer / QA / Marketer roles
- seeded projects and starter issues per funnel stage
- a dashboard funnel view for indie product execution

Key references:

- `packages/shared/src/types/company.ts`
- `server/src/services/company-blueprints.ts`
- `server/src/routes/companies.ts`
- `ui/src/components/OnboardingWizard.tsx`
- `ui/src/pages/Dashboard.tsx`

### 2.2 New social discovery pipeline

This PR introduces two new domain concepts:

- `social_signals`
- `social_signal_sources`

Signals represent raw market demand evidence; sources represent reusable ingestion definitions.

Key references:

- `packages/db/src/schema/social_signals.ts`
- `packages/db/src/schema/social_signal_sources.ts`
- `packages/shared/src/types/social-signal.ts`
- `server/src/services/social-signals.ts`
- `server/src/services/social-signal-sources.ts`
- `server/src/routes/social-signals.ts`
- `server/src/routes/social-signal-sources.ts`
- `ui/src/pages/SocialSignals.tsx`

### 2.3 New automation path

Once a source is configured, Paperclip can now:

1. ingest posts from X / Reddit
2. score imported signals with rules or LLM
3. auto-promote strong signals into issues
4. if promoted into `launch` or `growth`, move the issue into executable state and wake the assigned agent

Key references:

- `server/src/services/social-ingestion.ts`
- `server/src/services/social-signal-scoring.ts`
- `server/src/services/social-signal-automation.ts`
- `server/src/index.ts`

---

## 3. Tutorial: how the system works now

### 3.1 Bootstrap path

The board operator can now choose the zero-person path during onboarding.  
That path seeds:

- company metadata: operating model + blueprint state
- funnel labels/projects/issues
- role-aligned agents for PM / Engineer / QA / Marketer

This is done through the new zero-person blueprint service rather than a parallel provisioning system.

### 3.2 Signal capture path

There are now two ways to create demand inputs:

- manual signal capture
- source-driven ingestion from X / Reddit

Manual and imported signals land in the same `social_signals` pipeline, which keeps the control plane honest: discovery data is not hidden in an external crawler subsystem.

### 3.3 Promotion path

Signals can be reviewed and promoted into actual execution work.  
Promotion reuses the existing issue/project/goal model:

- stage determines which seeded project is targeted
- stage also selects the role-aligned assignee (`pm`, `engineer`, `qa`, `marketer`)
- signal metadata is preserved into issue description/context

### 3.4 Scheduler path

The PR deliberately avoids creating a new worker system.  
Instead, social source polling is attached to the existing server heartbeat loop:

- `heartbeat.tickTimers(...)`
- `heartbeat.reapOrphanedRuns(...)`
- `socialSources.tickScheduler(...)`

This is a good fit for V1 because it preserves operational simplicity.

### 3.5 Launch / growth execution kickoff

One subtle but important fix in this branch:

`socialSignalService.promote()` creates issues at the service layer, so route-level wakeup logic would not automatically fire.

This PR addresses that by adding `socialSignalAutomationService`, which:

- moves linked issues from `backlog` to `todo` when needed
- wakes the assignee through `heartbeat.wakeup(...)`
- logs `social_signal.execution_kicked_off`

That closes the loop from social discovery to actual execution.

---

## 4. Architectural shape of the change

## 4.1 Database layer

New or updated DB artifacts:

- `packages/db/src/schema/companies.ts`
- `packages/db/src/schema/social_signals.ts`
- `packages/db/src/schema/social_signal_sources.ts`
- `packages/db/src/migrations/0028_zero_person_rd_blueprint.sql`
- `packages/db/src/migrations/0029_social_signals_pipeline.sql`
- `packages/db/src/migrations/0030_social_signal_sources.sql`

Data-model impact:

- companies now store zero-person blueprint metadata
- signals and sources are company-scoped first-class records
- migrations are included for the full funnel expansion

## 4.2 Shared contracts

New shared constants/types/validators define the cross-layer contract for:

- zero-person operating model metadata
- dashboard funnel summary
- social signal entities
- source config, schedule, automation, scoring mode

Key references:

- `packages/shared/src/constants.ts`
- `packages/shared/src/types/company.ts`
- `packages/shared/src/types/dashboard.ts`
- `packages/shared/src/types/social-signal.ts`
- `packages/shared/src/validators/company.ts`
- `packages/shared/src/validators/social-signal.ts`

## 4.3 Server layer

The server changes are organized around composition, not duplication:

- blueprint bootstrap: `server/src/services/company-blueprints.ts`
- dashboard summary: `server/src/services/dashboard.ts`
- signal CRUD + promote: `server/src/services/social-signals.ts`
- source config + sync + schedule: `server/src/services/social-signal-sources.ts`
- ingestion adapters: `server/src/services/social-ingestion.ts`
- scoring: `server/src/services/social-signal-scoring.ts`
- promote aftermath / wakeup: `server/src/services/social-signal-automation.ts`

This is the right direction for Paperclip because the new product behavior sits on top of the existing orchestration model rather than bypassing it.

## 4.4 UI layer

User-facing additions:

- onboarding path for zero-person setup
- companies/dashboard support for the operating model
- new `Signals` page for manual signal capture and source management
- source configuration UI for:
  - X / Reddit credentials
  - auto-sync interval
  - scoring mode (`rules` / `llm`)
  - promotion thresholds

Key references:

- `ui/src/components/OnboardingWizard.tsx`
- `ui/src/pages/Companies.tsx`
- `ui/src/pages/Dashboard.tsx`
- `ui/src/pages/SocialSignals.tsx`
- `ui/src/api/socialSignals.ts`

---

## 5. Strengths of the implementation

### 5.1 Reuses existing control-plane invariants

The biggest strength is restraint:

- no parallel task system
- no parallel scheduler service
- no hidden market-intelligence subsystem

Everything still lands in the same company-scoped model.

### 5.2 Contract sync is mostly disciplined

The branch updates db/shared/server/ui together for the new domains, which is exactly what this repo expects.

### 5.3 Product story is much clearer

Before this work, the repo was a generic control plane.  
After this work, it has a concrete and demoable V1 narrative:

> mine demand -> validate demand -> build -> launch -> grow

### 5.4 Automation boundary is explicit

The new automation remains host-owned and visible:

- schedule is stored on source config
- scoring strategy is explicit
- fallback from LLM to rules is explicit
- mutations are activity-logged

---

## 6. Main maintainer notes

These are not blockers at this point, but they matter for follow-up work.

### 6.1 This is a large, product-defining PR

The branch spans:

- db
- shared contracts
- server orchestration
- UI onboarding/dashboard
- CLI/typecheck cleanup
- product/spec docs

That makes the PR mergeable, but not “small.” Reviewers should treat it as a feature train, not a minor patch.

### 6.2 LLM scoring currently uses direct OpenAI REST coupling

That is acceptable for V1, especially because it falls back to rules.  
But if more providers are added later, scoring may want a host-level abstraction similar to other adapter surfaces.

Current implementation reference:

- `server/src/services/social-signal-scoring.ts`

### 6.3 Manual migration files are part of the contribution

This branch includes hand-authored migrations rather than a freshly generated migration workflow.  
That is okay because verification now passes, but maintainers should ensure the migration history is reviewed carefully before release.

---

## 7. Verification status

Verified in local repo:

- `pnpm --filter @paperclipai/server typecheck`
- `pnpm --filter paperclipai typecheck`
- `pnpm -r typecheck`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run cli/src/__tests__/company-delete.test.ts`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run server/src/__tests__/social-signal-sources.test.ts`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run packages/shared/src/validators/social-signal.test.ts server/src/__tests__/social-signal-scoring.test.ts server/src/__tests__/social-signal-sources.test.ts server/src/__tests__/social-signals.test.ts`
- `pnpm build`

Non-blocking observation:

- UI build emits bundle/chunk size warnings, but build succeeds.

---

## 8. Suggested PR title and description

### PR title

`feat: add zero-person indie R&D mode with social signal pipeline and automated launch/growth execution`

### PR description

This PR turns the current Paperclip V1 target into a concrete zero-person indie R&D workflow.

It adds:

- zero-person company bootstrap for PM / Dev / Tester / Marketing
- funnel-aware dashboard and onboarding support
- first-class `social_signals` and `social_signal_sources`
- X / Reddit ingestion source configuration
- scheduled source sync in the existing heartbeat loop
- rules/LLM signal scoring and auto-promotion
- automatic launch/growth issue kickoff via heartbeat wakeup
- synced db/shared/server/ui contracts, tests, docs, and migrations

It also cleans up the historical `embedded-postgres` `initdbFlags` type mismatch so workspace typecheck/build pass again.

---

## 9. Suggested release notes

### Added

- zero-person indie R&D bootstrap flow
- PM / Dev / Tester / Marketing starter roles and funnel projects
- dashboard funnel visibility for `discover`, `validate`, `build`, `launch`, `growth`
- social signal CRUD and promotion flow
- X / Reddit ingestion sources with credential bindings
- scheduled source sync
- rules and optional LLM scoring
- auto-promotion and launch/growth auto-kickoff

### Improved

- onboarding now supports a concrete operator path for indie product teams
- docs now describe the zero-person product story directly
- workspace typecheck/build health is restored

### Internal

- new DB migrations for company blueprint metadata, social signals, and source configs
- added validator/server tests for blueprint bootstrap and social signal automation

---

## 10. Merge recommendation

**Merge as-is**, with one reviewer pass focused on:

1. migration correctness (`0028` / `0029` / `0030`)
2. API naming consistency around social signal routes
3. whether the direct OpenAI scoring integration should remain V1 scope

Everything else is in good shape for an integrated feature release.
