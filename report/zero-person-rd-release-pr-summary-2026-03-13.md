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

### 1.1 Addendum — enterprise delivery integration foundation (2026-03-15)

This branch now also begins the **enterprise delivery loop** needed for real R&D execution against external tools:

- shared/db contracts for `external_work_integrations`, `external_work_items`, and `external_work_item_events`
- TAPD / Gitee integration configuration types and validators
- a first server-side **TAPD OpenAPI provider** that can:
  - resolve company-scoped TAPD credentials via the existing secrets subsystem
  - read TAPD workspaces / iterations / stories / bugs / tasks
  - write back bug / task updates through TAPD OpenAPI
- an **external work mapping service** that:
  - persists TAPD records into `external_work_items`
  - maps TAPD story / task / bug records into existing Paperclip issues
  - keeps the mapping company-scoped and activity-visible
- a first **Gitee git workflow service** that:
  - syncs repo bindings into existing project workspaces
  - clones / pulls bound repos into the Paperclip instance workspace area
  - commits and pushes local changes back through git
  - prepares the repo state needed by the existing execution worktree strategy

This matters because it keeps the zero-person team narrative grounded in actual enterprise delivery systems instead of a demo-only loop. The implementation still reuses Paperclip primitives rather than adding a parallel orchestration stack.

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

---

## 11. Enterprise delivery addendum

Follow-up work on 2026-03-15 extends the zero-person R&D control plane into an **enterprise delivery loop** for indie teams that need to operate against TAPD + Gitee:

- TAPD project / iteration / story / task / bug sync already lands in `external_work_items`
- mapped TAPD items now auto-kick off assigned Paperclip issues through the existing heartbeat wakeup flow
- heartbeat now prepares the bound Gitee repo before execution, so agent runs can enter the existing project-workspace / git-worktree path with real code checked out
- heartbeat post-run automation now supports:
  - Gitee `git add / commit / push`
  - git worktree path pushback, not just primary repo root pushback
  - TAPD task / bug status writeback after execution
  - partial-failure handling when repo push succeeds but TAPD writeback fails
- the instance scheduler now also ticks external-work integrations, so scheduled TAPD sync can automatically wake the mapped assignee agent

### Additional files / services of note

- `server/src/services/external-work-automation.ts`
- `server/src/services/heartbeat.ts`
- `server/src/index.ts`
- `server/src/services/gitee-integration.ts`
- `server/src/__tests__/external-work-automation.test.ts`

### Additional verification

- `pnpm --filter @paperclipai/server typecheck`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run server/src/__tests__/external-work-automation.test.ts server/src/__tests__/gitee-integration.test.ts`
- `pnpm -r typecheck`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run`
- `pnpm build`

This means the current branch is no longer only “social signal → issue kickoff”; it now supports the broader loop:

**TAPD demand / delivery intake → Paperclip issue execution → Gitee code push → TAPD ticket writeback**

---

## 12. Operator surface addendum

The 2026-03-15 continuation also adds the missing **operator management surface** for this delivery loop.

### 12.1 Backend operator routes

New `server/src/routes/external-work.ts` exposes board-scoped management endpoints for:

- listing company integrations
- creating integrations
- updating integrations
- manually triggering sync
- listing synced external work items
- viewing item-level events

The route implementation intentionally follows the same structure as `social-signal-sources`:

- `assertBoard`
- `assertCompanyAccess`
- shared `validate(...)`
- `logActivity(...)`

This keeps the enterprise-delivery surface aligned with the existing operator API instead of creating a side-channel admin subsystem.

### 12.2 Frontend operator page

New UI artifacts:

- `ui/src/api/externalWork.ts`
- `ui/src/lib/external-work.ts`
- `ui/src/pages/ExternalWork.tsx`

And route/navigation wiring:

- `ui/src/App.tsx`
- `ui/src/components/Sidebar.tsx`
- `ui/src/lib/queryKeys.ts`

The new **External Work** page now lets board operators:

- create and edit TAPD integrations
- create and edit Gitee integrations
- bind TAPD scopes into existing Paperclip projects
- bind Gitee repos into existing Paperclip projects/workspaces
- trigger manual sync from the UI
- inspect synced external items and event history
- pre-configure browser-fallback credentials/state for future TAPD/Gitee browser automation

### 12.3 Why this matters

Without this addendum, the branch had strong service-layer capabilities but still required API-only operation for setup and inspection.

With the new operator surface, the branch now supports the full narrative:

1. configure TAPD and Gitee from the board UI
2. sync delivery context into Paperclip
3. let heartbeat runs work on the bound repo/worktree
4. push code back to Gitee
5. write status back to TAPD

That makes the “zero-person indie R&D team” story much closer to a real operating console rather than just a backend integration layer.

### 12.4 Additional verification

- `pnpm --filter @paperclipai/ui typecheck`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run ui/src/lib/external-work.test.ts server/src/__tests__/external-work-routes.test.ts server/src/__tests__/external-work-automation.test.ts server/src/__tests__/gitee-integration.test.ts`
- `pnpm -r typecheck`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run`
- `pnpm build`

---

## 13. Browser fallback addendum

The latest continuation also turns the previously declarative `browserAutomation` config into a real runtime capability.

### 13.1 New shared browser-backed fetch layer

New artifact:

- `server/src/services/browser-fallback.ts`

This helper:

- parses browser `storageState`
- parses raw `Cookie` headers into domain-scoped cookies
- optionally prewarms a login page
- launches Chromium through Playwright
- executes HTTP requests inside the browser context using session cookies

This is important because it keeps TAPD/Gitee browser-session recovery in one reusable place rather than scattering headless-browser logic across provider services.

### 13.2 TAPD fallback is now real

`server/src/services/tapd-integration.ts` now honors:

- `api_only`
- `prefer_api`
- `browser_only`

That means TAPD reads/writes can now:

1. use OpenAPI directly
2. fall back to a browser-backed authenticated session when API auth or provider availability fails
3. run browser-first when the integration is intentionally configured that way

### 13.3 Gitee fallback is now partially real

`server/src/services/gitee-integration.ts` now uses browser fallback for session-based HTTP recovery on the username-resolution path.

Important nuance:

- git clone / pull / commit / push still remain token/ssh based
- browser fallback currently augments session-based HTTP requests
- it does **not** replace git transport authentication

This is still a meaningful improvement because it gives the operator a recovery path for browser-authenticated Gitee API/session access without disturbing the stable git workflow.

### 13.4 Additional verification

- `pnpm --filter @paperclipai/server typecheck`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run server/src/__tests__/browser-fallback.test.ts server/src/__tests__/tapd-integration.test.ts server/src/__tests__/gitee-integration.test.ts`
- `pnpm -r typecheck`
- `PAPERCLIP_HOME=/tmp/paperclip-test pnpm test:run`
- `pnpm build`

At this point the branch supports not only:

**TAPD intake → Paperclip execution → Gitee push → TAPD writeback**

but also:

**API-first operation with browser-session fallback where external enterprise systems require it**
