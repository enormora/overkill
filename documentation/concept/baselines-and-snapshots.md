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

## Update Workflow

The CLI surface for baseline updates is one flag with three modes:

```
overkill run --update-baselines [<mode>]
```

Modes:

-   `--update-baselines` (no mode, equivalent to `=missing`) —
    create artifacts that don't yet exist; do **not** overwrite
    existing artifacts. Safest mode; cannot accidentally accept a
    regression.
-   `--update-baselines=changed` — overwrite existing artifacts that
    differ from the run output, create missing ones. Stale artifacts
    are reported but not removed.
-   `--update-baselines=clean` — `=changed` plus removal of stale
    artifacts (no corresponding collected test). The most invasive
    mode; explicit on purpose.

The default in CI is `--no-update-baselines` (any update flag is
rejected unless an environment variable explicitly opts in). The
default in dev is also `off`; updates only happen when the developer
asks.

Per `runtime-behavior.md` § CI Auto-Detection, baseline updates are
gated behind explicit intent in CI to prevent accidental rubber-
stamping.

### Review-Then-Commit Flow

The intended developer loop:

1.  Run normally; baselines compare. Mismatches fail the run with a
    structured diff (see `assertions-and-results.md` § Diff And
    Diagnostic Shape).
2.  Inspect the diff in the reporter or in the JSON event stream.
    Decide whether the change is intended.
3.  Re-run with `--update-baselines=changed` (or `=missing` for new
    tests). The runner overwrites the on-disk artifacts.
4.  `git diff test-baselines/` shows what changed. Review and commit
    those files together with the production change that caused the
    update.

The baselines live under version control precisely so step 4 makes
the update reviewable. A baseline change that doesn't fit on a code-
review screen indicates either a too-broad baseline or a too-broad
production change.

### Stale Artifact Handling

Stale baselines (no corresponding collected test) are detected after
the run by comparing the on-disk baseline files against the resolved
case identities. Default policy:

-   ordinary run: stale baselines are reported as warnings; CI runs
    treat them as failures (see `runtime-behavior.md` § CI
    Auto-Detection)
-   `--update-baselines=clean` removes them after the run completes
-   no automatic rename inference (see `non-goals.md` § No automatic
    rename inference) — a renamed test becomes a stale orphan plus a
    missing new baseline; the developer accepts both deliberately

### What The Runner Will Not Do

-   silently update baselines on a CI run, even when the diff would
    apply cleanly
-   merge two stale-but-similar baselines into one (no fuzzy rename
    inference)
-   delete baselines that match a different identity-form variant
    (e.g. the same test under a different runtime) without an
    explicit `=clean` mode

These are framed as non-goals to keep the update story honest about
what is and is not automatic.

## Package Position

Generic snapshots should live above the core, primarily in integration-oriented packages or shared baseline utilities. If research later proves that baseline identity or lifecycle must be in the core, that should be documented as a deliberate exception.
