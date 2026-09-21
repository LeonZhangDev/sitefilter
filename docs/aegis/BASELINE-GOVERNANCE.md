# Baseline Governance

## 1. Baseline Roles

- Product / Requirement Baseline: confirmed requirement sources, target state, goals and scope, users and scenarios, acceptance criteria, non-goals, workflow constraints, open questions, and approved specification intent.
- Architecture / Runtime Boundary Baseline: canonical owner, contract, source-of-truth boundary, dependency direction, compatibility, runtime-ready boundary, and retirement state.

## 2. Design Defect

A confirmed error, gap, contradiction, or wrong abstraction in the relevant requirement, design, or baseline must be corrected there before implementation is aligned.

## 3. Implementation Drift

Implementation, plan, review, or documentation that deviates from a confirmed and unchanged baseline must return to that baseline through the simplest stable path.

## 4. Compatibility Aliases

- Architecture Defect means an architecture-scoped Design Defect.
- Architecture Drift means architecture-scoped Implementation Drift.
- Findings report scope as requirements, architecture, or both.

## 5. Baseline Check Protocol

Before non-trivial changes:

1. Read the latest Product / Requirement Baseline.
2. Read the latest Architecture / Runtime Boundary Baseline.
3. Compare proposed work with acceptance criteria and ownership boundaries.
4. Check for new unrecorded anti-patterns.
5. Report aligned, Design Defect, Implementation Drift, missing-authority, or needs-clarification.

## 6. Architecture Review

Review ownership integrity, module boundaries, contract changes, cascade proliferation, dependency direction, retirement completeness, and net entropy.

## 7. Hard Boundaries

- This file governs this project's Aegis workspace.
- Baseline snapshots are evidence, not replacement authority.
- Architecture decisions do not replace baseline governance.
- Changes to this file require explicit user review.

