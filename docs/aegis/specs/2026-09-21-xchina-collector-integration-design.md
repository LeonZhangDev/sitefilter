# XChina Collector Integration Design

Date: `2026-09-21`  
Status: `approved by user; ready for implementation planning`

## Aegis Visibility

This design fixes the ownership and protocol boundary before implementation so that SiteFilter does not acquire a duplicate downloader, localhost security exceptions, or an unreliable WSL launch path.

## TaskIntentDraft

- Outcome: one-click XChina gallery/video downloads from SiteFilter through Universal Web Collector.
- Success evidence: real end-to-end downloads of the approved photo and video examples in Chrome and Edge, including automatic WSL startup and status restoration.
- Stop condition: implementation is not complete until both repositories pass their existing gates and the real outputs are verified.
- Non-goals: public distribution, non-Windows platforms, non-XChina sites, direct cookie export, and a second parsing fallback.

## BaselineReadSetHint

- SiteFilter: `README.md`, `manifest.json`, `content.js`, `background.js`, packaging and test scripts.
- Collector: `README.md`, `Makefile`, `scripts/start.py`, task schemas/API, XChina collectors, login-session API, and frontend task UI.
- Browser platform: official Chrome and Edge Native Messaging and manifest-key documentation.

## BaselineUsageDraft

- Required baseline refs: product requirements and initial dual baseline.
- Delivered context refs: user-approved decisions in the design conversation.
- Acknowledged before plan refs: cross-project ownership and WSL-only runtime.
- Cited in design refs: `docs/requirements/001-xchina-collector-integration.md`.
- Missing refs: none blocking.
- Decision: continue to written-spec review.

## Requirement Ready Check

- Requirement source refs: user conversation and `docs/requirements/001-xchina-collector-integration.md`.
- Goals and scope refs: Overview and Functional Reqs.
- User / scenario refs: User Stories.
- Requirement item refs: FR-1 through FR-11.
- Acceptance refs: Testing section.
- Open blocker questions: none.
- Decision: ready.

## ImpactStatementDraft

- SiteFilter layers: manifest, content UI, background native client, options/help, tests, packaging, documentation.
- Collector layers: startup supervisor, task API/schema, canonical identity/duplicate handling, frontend deep link, installer/native host, tests, documentation.
- Invariants: Collector owns downloads and task truth; bridge exposes no arbitrary execution; existing callers retain behavior.
- Compatibility: opt-in API additions and fixed Native Messaging protocol version.

## Existence Check

- Proposed new surface: Windows Native Messaging Host and `make start-native`.
- Existing reuse candidates: direct localhost calls and current `make start`.
- Why insufficient: direct calls require CORS/host permissions and expose dynamic ports; current start opens a browser and has no machine-readable readiness or idle lifecycle.
- Creation proof: browser extensions cannot directly start WSL processes; a registered native host is the platform-supported bridge.
- Entropy impact: one narrow bridge replaces multiple browser-side permissions and startup fallbacks.
- Decision: add with proof.

## Product Risk Lens

- Value: one action starts the downloader and creates a reliable task without duplicating configuration.
- Non-goals: generalized download manager UI inside SiteFilter.
- Trade-offs: one-time per-machine installation and a small Windows executable.
- Decision: use a Native Host proxy rather than direct localhost access.

## Architecture Integrity Lens

- Invariant: only Collector may decide how XChina content is resolved and downloaded.
- Canonical owners: SiteFilter UI, bridge transport/startup, Collector task/download state.
- Responsibility overlap: none; the bridge validates and forwards an allowlisted contract only.
- Higher-level simplification: reuse Collector preview, task, session, and configuration APIs.
- Falsifier: any implementation that parses media URLs in SiteFilter or accepts arbitrary host commands violates the design.
- Verdict: aligned.

## Baseline Role Alignment

- Product baseline: one-click, preview, automatic startup, status, notifications, duplicates, installation, and real-download acceptance.
- Architecture baseline: Native Host proxy with Collector as source of truth.
- Result: aligned.
- Scope: both.
- Next action: written-spec user review, followed by implementation planning.

## Options

### 1. Native Host proxy - selected

The extension communicates only through Native Messaging. The host starts WSL Collector and proxies allowlisted operations. This keeps dynamic ports and local API access outside the extension.

### 2. Native Host launcher plus direct localhost API

Rejected because it adds host permissions, CORS/security work, port discovery, and two communication paths.

### 3. Always-running Windows service

Rejected because it creates a heavier lifecycle and conflicts with the approved 30-minute idle exit.

## Detailed Design

### SiteFilter

The content script recognizes supported detail URLs, derives only a provisional page kind and GID for UI purposes, and renders the title control, panel entry, modal, and task summary. Canonical resolution remains server-side.

The service worker owns one `connectNative` port while requests or active tasks exist. It correlates requests, mirrors task summaries to relevant tabs, persists minimal URL-to-task association and notified terminal states, and emits browser notifications. It disconnects after terminal state delivery and no pending requests.

The manifest gains `nativeMessaging`, a fixed public `key`, and no localhost host permission.

### Native Host

The installed Windows executable implements protocol version 1 using length-prefixed UTF-8 JSON over binary stdin/stdout. It validates caller origin, action, payload size, HTTPS XChina URLs, and supported page shapes. It writes diagnostics outside stdout.

The host reads installer-owned configuration from the current user's local application data. It starts the selected WSL distribution only when health discovery fails, waits for a runtime descriptor and health check, then proxies only explicit operations. It never accepts shell fragments from the extension.

### Collector startup

`make start-native` delegates to the existing startup script in production mode with no browser opening. A single-instance guard prevents duplicate backends. A runtime descriptor records protocol version, port, instance ownership, and readiness without containing credentials.

The natively owned startup supervisor observes activity. It exits after 30 idle minutes only when no pending/running/extracting/downloading/paused tasks and no enabled subscriptions exist. It does not terminate a Collector instance it did not start.

### Collector task contract

Collector computes canonical XChina content identity. An opt-in duplicate policy extends task creation while preserving current behavior by default.

- Active match: return existing task with `reused-active`.
- Completed match without confirmation: return `confirm-redownload` without creating a task.
- Confirmed completed match: create an incremental task.
- Failed/partial match: return `recommend-retry` or `recommend-resume`.

Lookup and creation execute under one Collector-owned synchronization boundary. Existing historical tasks are normalized lazily so a schema backfill is not required solely for this feature.

Task detail responses provide progress and resource counts. The frontend accepts a task query parameter and selects the requested task after loading.

### Error handling

Stable error codes distinguish installation, protocol, WSL, path, dependency, startup, login, preview, duplicate decision, and task failures. User messages include one next action. Host or protocol incompatibility directs the user to rerun the installer rather than attempting an unsafe fallback.

### Security

- Exact extension origin allowlist.
- Fixed, versioned action schema.
- No arbitrary command, path, endpoint, or URL forwarding.
- No browser-cookie access.
- No localhost permission in SiteFilter.
- Native stdout reserved exclusively for protocol framing.
- Installer and uninstall operate only on explicit LocalAppData and HKCU targets.

## Complexity Budget

- Artifact class: cross-project runtime integration.
- High-pressure files: SiteFilter `content.js` and `background.js`, Collector task API and startup script.
- Current pressure: both SiteFilter files are already large; Collector already has the correct API and startup owners.
- Projected pressure: at risk if all bridge behavior is added inline.
- Planned governance: extract the SiteFilter native client into a dedicated background helper and keep page UI changes localized; place installer/host code under one Collector integration directory.
- Recommendation: add owner files for transport and installation, edit existing owners only at their defined seams.

## Verification Strategy

Verification proceeds from unit tests to mocked integration, packaging gates, Chrome/Edge native registration, then approved real downloads. Existing test suites must remain green. Real output verification includes file counts/types, playable video, task terminal status, duplicate behavior, state restoration, notification deduplication, and idle lifecycle.

## ADR Signal

The Native Host proxy, Collector-owned canonical identity, and dependency direction are durable architecture decisions. After implementation proves the contract, record them as an ADR; do not mark the ADR accepted before runtime verification.

## Decision

The user approved this written specification on `2026-09-21`. Implementation must follow the staged plan indexed from `docs/aegis/INDEX.md`.
