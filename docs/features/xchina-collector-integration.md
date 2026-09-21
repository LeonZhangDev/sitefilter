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
- Implementation has not started. The next artifact is a staged implementation plan after user review of the written specification.

