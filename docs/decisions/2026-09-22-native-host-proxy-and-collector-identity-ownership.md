# ADR: Native Host Proxy and Collector Identity Ownership

**Date**: 2026-09-22
**Status**: Accepted
**Context**: SiteFilter to Universal Web Collector integration for XChina detail pages

## Problem

The browser extension needs to start or discover Collector, preview a download, create a task, and restore that task after page or browser restarts. A direct localhost client would expose changing ports and lifecycle details to the page integration. Reimplementing URL normalization or duplicate rules in the extension would also create two competing identities for the same gallery or video.

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| Direct extension-to-localhost API with raw URL identity | Fewer transport files; simple prototype | Requires localhost permissions and port discovery; duplicates lifecycle and identity policy in the extension; raw pagination/query URLs can create duplicate tasks |
| Native Messaging proxy with Collector-owned content identity | Keeps browser permissions narrow; supports validated startup and readiness; one canonical identity and task database | Requires per-user browser registration, a fixed extension ID, WSL configuration, and explicit host lifecycle handling |
| Parse and download XChina media inside the extension | No local service startup | Duplicates Collector extraction, cookies, retries, persistence, and output policy; browser lifecycle is unsuitable for long downloads |

## Decision

**Chosen**: Native Messaging proxy with Collector-owned content identity.

SiteFilter sends allowlisted commands through a per-user Native Host. The host validates the request, starts or discovers the configured Collector instance, and proxies protocol messages without becoming a second task owner. Collector canonicalizes XChina URLs to `xchina_gallery:<id>` or `xchina_video:<id>` and remains the sole owner of extraction, duplicate disposition, task persistence, retries, files, and integrity checks.

The extension may persist only the mapping needed to restore UI state and suppress duplicate terminal notifications. Browser cookies and absolute private output paths are not rendered into page DOM or committed as evidence.

## Consequences

**Positive**: URL variants restore one task; long-running work survives MV3 worker restarts; Collector policies and output settings remain authoritative; the extension avoids direct localhost access and duplicated media logic.

**Negative**: Installation must keep Chrome and Edge registrations, the deterministic extension ID, WSL distribution, host version, and protocol version aligned. Native startup and shutdown require bounded process and network behavior. Collector remains the data owner, so missing task/output data cannot be reconstructed authoritatively from the extension's minimal UI mapping.

**Follow-up tasks**: Clarify the observed loss of live Tasks 1–3 before closing the data-retention acceptance gate; consider auditable provenance for destructive Collector operations as a separate scoped decision; merge both feature branches after review; publish/install only from reviewed artifacts; treat preview byte-estimate accuracy as optional follow-up work.
