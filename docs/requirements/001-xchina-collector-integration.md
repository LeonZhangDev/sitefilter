# 001 - XChina Collector Integration

## Overview

SiteFilter shall add one-click download controls to XChina photo and video detail pages. SiteFilter owns page integration and user feedback, while Universal Web Collector remains the only owner of resource discovery, authentication state, task persistence, downloading, retries, and output configuration.

The integration targets unpacked SiteFilter installations in Chrome and Edge on the user's Windows 11 computers. A registered Windows Native Messaging Host starts Universal Web Collector inside the selected default WSL distribution when necessary and proxies a narrow set of task operations.

Canonical design: [XChina Collector integration design](../aegis/specs/2026-09-21-xchina-collector-integration-design.md).

## User Stories

1. As a user viewing an XChina photo detail page, I can download every image and video belonging to that gallery with one click.
2. As a user viewing an XChina video detail page, I can create a video download task with one click.
3. As a user, I can preview the detected collector, title, resource counts, estimated video size, warnings, and output directory before confirming.
4. As a user, I do not need to start Universal Web Collector manually before downloading.
5. As a user, I can see task progress in the XChina page and receive a notification when the task finishes or fails.
6. As a user returning to the same content, I can see the latest task and avoid accidental duplicate downloads.
7. As a user on a new Windows computer, I can install the bridge through one guided PowerShell installer for Chrome and Edge.

## Functional Reqs

### FR-1 Page recognition

- Recognize `https://xchina.co/photo/id-<gid>.html` and paginated equivalents as photo details.
- Recognize `https://xchina.co/video/id-<gid>.html` as video details.
- Normalize photo identity to `xchina_gallery:<gid>` and video identity to `xchina_video:<gid>`.
- Ignore pagination, query strings, fragments, and equivalent supported XChina host variants when determining identity.

### FR-2 Download controls

- Add a clearly branded `交给 Collector 下载` control beside the stable page heading.
- Add the same control and shared state to SiteFilter's `本页` panel.
- Photo primary action shall use automatic media selection and therefore include all images and videos in the gallery.
- Video primary action shall create an XChina video task.
- The action menu shall offer preview, image-only, and video-only choices where supported.
- Both UI locations shall bind to one logical task and must not create duplicates independently.

### FR-3 Preview

- Preview shall be displayed in a SiteFilter modal on the current page.
- It shall show resolved collector, album title, image count, video count, estimated video size, output directory, sampled/estimated state, and Collector warnings.
- Preview shall use Universal Web Collector's existing configuration and preview APIs.

### FR-4 Automatic startup

- SiteFilter shall communicate with a Windows Native Messaging Host through Manifest V3 native messaging.
- If Collector is unavailable, the host shall start it in the configured default WSL distribution from the user-selected project directory.
- Startup shall be silent: no PowerShell console and no automatic management-page tab.
- WSL shall invoke the dedicated `make start-native` entrypoint, which reuses the existing startup implementation with native-integration flags.
- Startup shall return a machine-readable readiness result including the actual backend port and protocol version.
- Concurrent startup requests shall converge on one Collector instance.

### FR-5 Task creation and duplicates

- Collector shall remain the canonical owner of URL resolution and content identity.
- Duplicate lookup shall cover all Collector tasks, regardless of whether they originated in SiteFilter or the Collector UI.
- An active matching task shall be reused.
- A completed matching task shall require confirmation before a new incremental task is created.
- A failed or partial task shall recommend retry or resume instead of silently creating another task.
- Duplicate check and task creation shall be atomic inside Collector.
- Re-download shall enable incremental reuse of previously successful resources.

### FR-6 Status and navigation

- Page status shall cover startup, pending, extracting, downloading, paused, success, partial success, cancelled, and failed states.
- Active status shall show percentage and completed/total resource counts.
- Reloading or revisiting the page shall restore the latest matching task.
- `查看任务` shall open the Collector management UI focused on the corresponding task.
- The Collector frontend shall accept a task deep link such as `/?task=<id>`.

### FR-7 Notifications

- Success, partial success, and failure shall trigger Chrome/Edge notifications.
- Each terminal task state shall be notified at most once.
- Clicking a notification shall open the corresponding task detail.

### FR-8 Login recovery

- Collector shall use its own saved XChina browser state.
- If the state is missing or invalid, SiteFilter shall show an actionable message and start Collector's existing interactive login-session flow.
- Login UI may rely on Windows 11 WSLg.
- SiteFilter shall not read, export, or copy Chrome/Edge cookies.

### FR-9 Idle lifecycle

- A natively started Collector shall exit only after 30 continuous idle minutes.
- Pending, extracting, downloading, paused, or otherwise active tasks shall prevent exit.
- Any enabled subscription source shall prevent exit.
- New work shall cancel an in-progress idle countdown.
- Existing manually started Collector instances shall not be terminated by the bridge.

### FR-10 Installation

- `install-native-host.ps1` shall ask the user to choose the Collector project directory.
- It shall detect and save the default WSL distribution, validate WSLg, translate the selected Windows path, provision required Collector dependencies, build the frontend, and verify Playwright Chromium and FFmpeg.
- It shall install a Windows native host under the current user's local application data and register host manifests under Chrome and Edge HKCU registry locations.
- SiteFilter shall use a fixed public manifest key so its unpacked extension ID remains stable across machines and browsers.
- The host manifest shall allow only that extension origin.
- `uninstall-native-host.ps1` shall remove bridge files and registry entries without deleting Collector data or downloads.
- When the host is absent, download controls shall remain visible and show installation guidance plus a retry-detection action.

### FR-11 Security boundary

- Native messages shall be versioned and correlated by request ID.
- Allowed operations shall be limited to ping, preview, create-or-reuse, get-task, open-task, and start-login.
- The host shall reject arbitrary commands, arbitrary executable paths, arbitrary API paths, and unsupported URL origins.
- Native protocol stdout shall contain framing only; diagnostics shall go to stderr or log files.
- The extension shall not require direct localhost API access or CORS exceptions.

## Non-Functional Reqs

- Support current Chrome and Microsoft Edge on Windows 11 with WSLg.
- Preserve existing SiteFilter filtering, panel, popup, and storage behavior.
- Preserve existing Universal Web Collector API behavior for callers that do not opt into duplicate handling.
- First normal startup after installation should report readiness or a specific actionable failure within 60 seconds.
- UI actions must be idempotent while a request is pending.
- Failures must distinguish host missing, WSL unavailable, project invalid, dependency failure, Collector startup failure, login required, preview failure, and task failure.
- The integration shall not duplicate XChina parsing or download logic in SiteFilter.
- All user-visible strings shall be Chinese and must remain readable in both light and dark XChina themes.

## Data Model

### Native request

```json
{
  "v": 1,
  "id": "request-id",
  "action": "create-or-reuse",
  "payload": {
    "url": "https://xchina.co/photo/id-6664761937f5a.html",
    "media": "auto",
    "force_new": false
  }
}
```

### Native response

```json
{
  "v": 1,
  "id": "request-id",
  "ok": true,
  "result": {
    "task_id": 123,
    "content_key": "xchina_gallery:6664761937f5a",
    "disposition": "created"
  }
}
```

Errors use a stable code, Chinese message, and `retriable` flag. Supported dispositions are `created`, `reused-active`, `confirm-redownload`, `recommend-retry`, and `recommend-resume`.

SiteFilter may persist only task association and notification-deduplication metadata. Collector remains the source of truth for task and resource state.

## UI/UX

- Title placement shall anchor to the page's stable level-one heading container, with a resilient fallback to SiteFilter's `本页` panel.
- The label must explicitly mention Collector because the XChina photo page already contains its own `下载` text.
- While startup or task creation is pending, both entry points shall be disabled and show the same progress state.
- Preview is a modal with confirm and cancel actions; it must not navigate away from the current page.
- Detailed logs and speed remain in Collector; SiteFilter shows summary progress only.
- Missing host guidance shall not look like a download failure.

## API

- Reuse `/healthz`, `/config`, `/tasks/preview`, `/tasks/{id}`, `/tasks/{id}/retry`, `/tasks/{id}/resume`, and `/sessions/login` where their existing contracts suffice.
- Extend task creation with a backward-compatible, opt-in atomic duplicate policy and structured disposition result. Existing callers retain current always-create behavior unless they request deduplication.
- Add a task lookup by canonical content identity only if extending task creation cannot provide restoration without duplicating canonicalization in the bridge.
- Add management-page task deep-link handling without changing existing root-page behavior.
- Native Host shall proxy only the allowlisted operations and shall not expose a general HTTP tunnel.

## Testing

- Unit-test XChina URL normalization, native message framing, allowlist validation, duplicate dispositions, idle lifecycle, and notification deduplication.
- Test extension behavior with a mocked Native Host for missing, starting, ready, incompatible, and failed states.
- Test Chrome and Edge HKCU registration and uninstall in disposable test keys before using production keys.
- Run existing SiteFilter JavaScript suites and packaging gate.
- Run the complete Universal Web Collector Python and frontend test suites.
- Execute real end-to-end downloads for:
  - `https://xchina.co/photo/id-6664761937f5a.html`
  - `https://xchina.co/video/id-6aaee7c9a12e8.html`
- Verify final files, task status, duplicate behavior, page reload restoration, notifications, WSLg login recovery, and idle shutdown.
- Retain completed test downloads unless the user explicitly asks to remove them.

## Open Questions

No blocking product questions remain. Public store distribution, macOS/Linux support, non-XChina sites, and operation without WSLg are explicitly deferred.

