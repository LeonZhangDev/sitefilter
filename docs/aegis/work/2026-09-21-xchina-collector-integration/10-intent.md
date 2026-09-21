# XChina Collector Integration — Task Intent

## Requested Outcome

Implement the approved XChina-to-Universal-Web-Collector integration described by the parent requirements, design, and implementation plan.

## Scope

- SiteFilter Manifest V3 UI, service-worker transport, restoration, and guidance.
- Universal Web Collector content identity, duplicate disposition, task summary/deep links, and native startup supervision.
- A per-user Windows Native Messaging Host plus installer/uninstaller.
- Chrome and Edge real-download acceptance for the approved XChina photo and video URLs.

## Non-Goals

- No extension-side XChina media parsing or download fallback.
- No Chrome Web Store or Edge Add-ons publication.
- No additional supported sites.
- No ownership of Collector settings, login state, output naming, or download logic in SiteFilter.

## Risk Hints

- Cross-project API compatibility and SQLite migrations.
- Native Messaging trust boundary and stable extension IDs.
- WSL process ownership, idle shutdown, and login recovery.
- Real downloads may depend on current XChina access and saved browser state.

## Goal and Stop Condition

The goal is satisfied only when every task in the parent plan passes specification review, code-quality review, and the stated verification. Stop with `done`, `blocked`, `needs-verification`, or `scope-exceeded`; do not claim completion from partial evidence.

## BaselineReadSetHint

- `docs/requirements/001-xchina-collector-integration.md`
- `docs/aegis/specs/2026-09-21-xchina-collector-integration-design.md`
- `docs/aegis/baseline/2026-09-21-initial-baseline.md`
- `docs/aegis/plans/2026-09-21-xchina-collector-integration.md`
- SiteFilter `README.md`, `manifest.json`, `content.js`, `background.js`, `make_package.py`, `ci.py`
- Collector `README.md`, `Makefile`, `scripts/start.py`, `backend/api/tasks.py`, `backend/models/schemas.py`, `backend/core/database.py`, `backend/core/task_manager.py`, `frontend/src/App.vue`

## BaselineUsageDraft

- Required refs: all BaselineReadSetHint entries.
- Acknowledged refs: requirements, design, initial baseline, implementation plan, and the listed project entry points during planning.
- Cited refs: implementation plan `Baseline/Authority Refs` and this intent record.
- Missing refs: none known.
- Decision: continue with Task 0 repository bootstrap; re-check file-level baselines before each implementation slice.

## ImpactStatementDraft

The work introduces a narrow native adapter, new Collector API behavior behind an opt-in flag, a small database identity extension, and XChina-specific extension controls. Existing SiteFilter filtering and existing Collector task creation must remain compatible.

## Execution Readiness View

- Intent lock: implement only the approved XChina integration.
- Scope fence: two local repositories and a per-user Native Messaging installation surface.
- Owner constraints: Collector alone parses, authenticates, downloads, stores settings, and owns task truth.
- Compatibility boundary: existing `/tasks/create` remains always-create unless `deduplicate=true`; existing SiteFilter behavior remains unchanged outside matched XChina detail pages.
- Retirement boundary: no temporary localhost extension permission or extension-side parser may remain.
- Task batches: Tasks 0–10, sequential, one implementation agent per task.
- Test obligations: each task's RED/GREEN commands, both reviews, full repository gates, packaged-host round trip, and two-browser real downloads.
- Review gates: specification compliance before code quality; all findings fixed and re-reviewed.
- Drift/rewind: pause if a new owner, public contract, permission, persistence surface, or unsupported fallback is required.
- Completion evidence: commits, command outputs, acceptance artifacts, final review, and goal-closure verification.
- Advisory boundary: these records organize evidence but do not independently grant completion.

