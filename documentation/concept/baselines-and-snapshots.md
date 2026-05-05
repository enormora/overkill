# Baselines And Snapshots

## Unified Baseline Concept

Overkill should use **baseline** as the umbrella term for any checked-in artifact that is compared during a run and updated intentionally.

This lets the product share workflow concepts across:

-   content snapshots
-   visual baselines
-   terminal baselines
-   performance budgets

## Why Unify Them At All

They share important operational behavior:

-   checked into version control
-   reviewed in code review
-   diffable
-   comparable during runs
-   explicitly updated
-   potentially stale when tests are removed or renamed

## Why Not Collapse Their Semantics

The workflow is shared, but the meaning is not.

### Content Snapshots

These capture serialized structure or output. They are usually compared for exact or domain-aware equality.

### Visual Or Terminal Baselines

These compare rendered output or accessibility structure. They need domain-aware comparison and often test-family-specific storage.

### Performance Baselines

These are stricter than ordinary snapshots. They often need:

-   thresholds
-   tolerances
-   normalization
-   per-metric policies
-   median and percentile semantics

## Stale Baseline Detection

Stale baseline cleanup must be first-class.

The concept should assume the runner can detect:

-   baseline entries with no corresponding collected test
-   obsolete files for removed or renamed tests
-   orphaned performance budgets

CI behavior should treat stale baselines as failures unless an intentional cleanup/update mode is used.

Vitest’s CI behavior around obsolete snapshots is a useful reference point.

Source:

-   <https://vitest.dev/guide/snapshot.html>

## Update Policy

Baseline updates should always be explicit.

Ordinary runs:

-   compare only
-   fail on mismatch, missing artifacts, or stale artifacts

Explicit update runs:

-   create new artifacts
-   update changed artifacts
-   remove stale artifacts where the chosen mode allows it

## Package Position

Generic snapshots should live above the core, primarily in integration-oriented packages or shared baseline utilities. If research later proves that baseline identity or lifecycle must be in the core, that should be documented as a deliberate exception.
