# SiteFilter Initial Baseline

Date: `2026-09-21`  
Status: `initial dual-baseline snapshot`

## 1. Purpose

Record the product and runtime ownership boundaries needed to design and review the XChina Collector integration without moving download logic into SiteFilter.

## 2. Workspace Structure

- `manifest.json`: Chrome/Edge Manifest V3 declaration.
- `content.js`: page recognition, card filtering, floating panel, and page UI.
- `background.js`: service worker, alarms, context menus, and background operations.
- `options.*` and `popup.*`: configuration surfaces.
- `expr.js`: rule expression engine.
- `ci.py` and `make_package.py`: verification and packaging.

Universal Web Collector is a separate repository selected at install time. Its current local reference is `C:/Users/admin/Desktop/universal_web_collector_v9`.

## 3. Current Authority Surfaces

- `README.md` describes current SiteFilter behavior and release workflow.
- `manifest.json` is extension runtime authority.
- `docs/requirements/001-xchina-collector-integration.md` is product authority for this feature after user review.
- `docs/aegis/specs/2026-09-21-xchina-collector-integration-design.md` is the cross-project design authority after user review.

## 4. Product / Requirement Baseline

### 4.1 Current Truth

SiteFilter is a local Chrome/Edge filtering and browsing-assistance extension. The approved target adds XChina photo/video download controls, automatic WSL Collector startup, preview, status, notifications, task restoration, and guided installation.

Acceptance requires real downloads of the two user-provided XChina examples in both Chrome and Edge.

### 4.2 Non-negotiables

1. SiteFilter must not implement a second XChina downloader.
2. User download configuration remains owned by Collector.
3. Native startup is silent and works after one per-machine installation.
4. Existing SiteFilter features and Collector callers remain compatible.

### 4.3 Product Non-goals

- Public store release.
- macOS or Linux desktop support.
- Other websites.
- Direct browser-cookie export.

## 5. Architecture / Runtime Boundary Baseline

### 5.1 Current Truth

- SiteFilter owns browser UI and browser notifications.
- A Windows Native Messaging Host owns the trusted browser-to-local bridge and WSL startup.
- Universal Web Collector owns parsing, canonical identity, task state, duplicate decisions, login state, downloading, and output.
- Dependency direction is SiteFilter to bridge to Collector; no reverse dependency is required.

### 5.2 Architecture Non-negotiables

1. No general shell or HTTP proxy may be exposed through Native Messaging.
2. Duplicate decisions and task creation must be atomic in Collector.
3. The bridge may not become a second task database.
4. Existing `/tasks/create` semantics remain unchanged for callers that do not opt in.

### 5.3 Architecture Non-goals

- Windows service or tray application.
- Direct localhost access from the extension.
- Persistent duplication of Collector configuration in SiteFilter.

## 6. Ownership / Contract Snapshot

- XChina page UI: SiteFilter content script.
- Native connection and notification coordination: SiteFilter service worker.
- Native framing and WSL startup: installed Windows bridge.
- Runtime startup and idle exit: Collector startup supervisor.
- Task and resource truth: Collector database and task manager.

## 7. Current State and Risks

- SiteFilter source is currently an untracked directory inside a broader `C:/Users/admin` Git worktree rather than an independent repository.
- The integration does not yet exist.
- Main risks are Native Messaging framing, WSL localhost reachability, startup concurrency, duplicate races, and cross-project protocol drift.

## 8. Alignment Use

Read the requirement baseline before changing user behavior. Read the runtime boundary baseline before changing Native Messaging, startup, task APIs, or ownership.

## 9. Compatibility Boundary

The feature must preserve current extension behavior and all existing Collector API clients unless they explicitly opt into the new integration contract.

