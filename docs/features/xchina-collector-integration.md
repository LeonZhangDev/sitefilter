# XChina Collector Integration

## Overview

SiteFilter adds XChina detail-page download controls and delegates all collection and download work to Universal Web Collector through a Windows Native Messaging bridge.

## Design Decisions

- Universal Web Collector is the sole owner of XChina parsing, login state, tasks, retries, output settings, and downloaded files.
- Native Messaging proxies the integration; the extension does not call localhost directly.
- Collector runs in the configured default WSL distribution and starts through `make start-native`.
- XChina content identity, not raw URL equality, controls task restoration and duplicate handling.
- The bridge is installed per-user for unpacked Chrome and Edge installations with one fixed extension ID.

## Implementation Notes

- Product requirements: [001 - XChina Collector integration](../requirements/001-xchina-collector-integration.md)
- Approved design: [2026-09-21 XChina Collector integration design](../aegis/specs/2026-09-21-xchina-collector-integration-design.md)
- Architecture decision: [Native Host proxy and Collector identity ownership](../decisions/2026-09-22-native-host-proxy-and-collector-identity-ownership.md)
- The implementation and code-quality gates are complete in the two `codex/xchina-collector-integration` feature worktrees. It has not been merged into either saved-project checkout and has not been published.
- The extension owns the page controls, preview/confirmation flow, status restoration, deep links, and at-most-once terminal notifications. The Native Host owns only validated transport and lifecycle startup. Collector owns URL normalization, duplicate identity, extraction, downloads, persistence, and output integrity.
- Live acceptance used branded Chrome and Edge with the fixed extension ID, a per-user Native Host registration, Ubuntu under WSL 2, and Collector port 8000. Evidence and task identifiers are recorded in the Aegis evidence log; downloaded media and browser profiles remain ignored local data.

## Acceptance Status

- Chrome Task 1 previously passed the real gallery workflow and integrity checks. Edge Tasks 2 and 3 exposed and then verified the HLS completeness fixes. Those three task records and their numbered output directories are now missing from the same live Collector database and download root; the deletion source is unknown.
- Fresh Edge Task 4 passed explicit force-new creation, full download, `ffprobe`, SHA-256 verification, reload/deep-link restoration, actual service-worker notification observation, and restart-safe no-duplicate notification behavior.
- The normal installer and self-check completed successfully and left the Native Host registered for Chrome and Edge with an owned/ready Collector runtime.
- Code behavior is accepted, but the data-retention portion of Task 10 remains open pending user clarification about the missing Tasks 1–3. The overall acceptance checklist is therefore not marked fully complete.

## Limits

- The integration requires the per-user Native Host registration and the configured WSL distribution; the extension does not fall back to direct localhost calls.
- Only approved XChina detail URLs and exact media hosts receive the specialized browser TLS session. Arbitrary URLs cannot opt in.
- HLS acceptance is fail-closed for missing `#EXT-X-ENDLIST`, unsupported live/sliding playlists, probe failure, or material duration truncation. Ordinary non-HLS video behavior is unchanged.
- The XChina preview may report an inaccurate byte estimate before download. Final task counts, hashes, and media probing remain authoritative.
- Terminal notifications are restart-safe and at-most-once. A crash after the persisted delivery claim but before browser creation can omit a notification rather than duplicate one.

