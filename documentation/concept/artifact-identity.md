# Artifact Identity

## Purpose

This document defines how Overkill should think about stable identities for tests, cases, environments, workloads, and the artifacts associated with them.

## Position

Stable identity is a cross-cutting concern.

It affects:

-   selection
-   baselines
-   failure artifacts
-   reproducibility
-   benchmark policies
-   reporter output

## Identity Layers

Overkill should likely distinguish at least:

-   test definition identity
-   expanded case identity for parameterized or macro-generated cases
-   environment identity
-   workload identity for benchmarks
-   artifact identity derived from the above

## Why This Matters

Without stable identities, Overkill cannot do these cleanly:

-   stale-baseline detection
-   deterministic randomization replay
-   benchmark budget lookup
-   multi-environment reporting
-   failure artifact naming

## Recommended Direction

Artifact identity should be derived from structured parts rather than string hacks.

Those parts likely include:

-   file or module origin
-   group or suite name when present
-   test name
-   parameterization key
-   environment key
-   workload key
-   artifact subtype

The exact path format is an implementation detail. The concept requirement is stable derivation from structured identity.
