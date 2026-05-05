# Metadata And Selection

## Purpose

This document defines how Overkill should describe tests beyond their executable body and how users should select subsets of a run without falling back to inline `.only` culture.

## Position

Overkill should treat test metadata as explicit structured data rather than ad-hoc naming conventions.

Likely metadata categories:

-   tags
-   environments
-   capabilities
-   baseline usage
-   ownership or domain labels
-   test kind such as microtest, integration, browser, or benchmark
-   stability markers such as flaky or quarantined

## Selection Model

Selection should belong to orchestration, not to hidden inline controls inside the test file.

That means users should be able to filter by:

-   test id
-   file path
-   group name
-   tags
-   metadata traits
-   environment or workload name
-   test kind

This is the conceptual replacement for relying on `.only`.

## Recommended Shape

The metadata should be:

-   explicit
-   serializable
-   visible to reporters
-   visible to run planning
-   stable enough to participate in artifact identity

The main requirement is not the exact syntax. The main requirement is that selection, reporting, and artifact naming all depend on the same metadata model.

## Stability Markers

Overkill should distinguish between:

-   known-flaky integration-style tests
-   quarantined tests temporarily excluded from gating
-   intentionally non-deterministic benchmarks or stress workflows

Microtests should not normalize retries or flaky markers. If a microtest is flaky, that should be treated as a design failure, not an expected state.

Integration-style packages may allow controlled retries or quarantine flows, but those should be visible in metadata and reporting.
