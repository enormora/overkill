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

Stale baselines fail the run by default; removing them requires an explicit `overkill baseline apply` or `overkill baseline clean`.

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

Baseline operations live under the `baseline` subcommand namespace
(registered in `cli.md` § Subcommands § Baseline). The verbs split
along intent:

| Verb        | Creates missing | Overwrites changed | Removes stale | Runs tests |
| ----------- | --------------- | ------------------ | ------------- | ---------- |
| `update`    | yes             | yes                | **no**        | yes        |
| `apply`     | yes             | yes                | **yes**       | yes        |
| `bootstrap` | yes             | no                 | no            | yes        |
| `list`      | —               | —                  | —             | no         |
| `clean`     | no              | no                 | yes           | no         |
| `diff`      | no              | no                 | no            | yes        |

The subcommand framing reflects user intent: the primary artifact is
on-disk baselines, not the verdict (see `cli.md` § Flags vs
Subcommands). The write verbs (`update`, `apply`, `bootstrap`) accept
the same selection, capability, and output flags as `run`, since
updating still requires executing the selected tests.

Day-to-day choice:

-   `overkill baseline update` is the safe default. It creates new
    baselines for newly added tests and overwrites baselines whose
    content changed. It **does not delete anything**, so an in-progress
    rename or a temporarily-skipped test cannot lose its baseline by
    accident.
-   `overkill baseline apply` is the deliberate cleanup verb. It does
    everything `update` does **and** removes stale orphans. Use it
    when committing a rename or a deletion: the diff in
    `test-baselines/` will include the removals, making the cleanup
    reviewable in the same change.
-   `overkill baseline bootstrap` is for the very first time you adopt
    Overkill in a project. It only creates baselines that don't exist
    yet; existing baselines are left alone (so a partial bootstrap
    doesn't trample a baseline that was authored by hand). After the
    suite has baselines, you stop using `bootstrap` and switch to
    `update` / `apply`.

Read-only and disk-only verbs:

-   `overkill baseline list` prints every baseline currently on disk
    with its resolved identity. No test execution. Useful for
    auditing what the suite has accumulated.
-   `overkill baseline diff` shows what `apply` would change. It runs
    tests but writes nothing — a dry-run for review pipelines.
-   `overkill baseline clean` removes stale orphans without running
    tests or touching active baselines. Use it when you have already
    deleted tests and want to clear their abandoned baselines without
    re-running the suite.

When `overkill run` is invoked instead, no baseline writes happen —
comparison-only is the default mode. The runner does not gate baseline
writes by environment; if a CI workflow runs a write verb, that is
what the workflow author intended. The author of the workflow is
responsible for not putting `baseline apply` in a check-only pipeline.

### Review-Then-Commit Flow

The intended developer loop:

1.  Run normally with `overkill run`; baselines compare. Mismatches
    fail the run with a diff appropriate to the baseline subtype:
    structured for content snapshots (text, JSON, objects), size and
    hash for opaque binary artifacts, and adapter-specific
    representations for visual or performance baselines (see
    `assertions-and-results.md` § Diff And Diagnostic Shape).
2.  Inspect the diff in the reporter or in the JSON event stream.
    Decide whether the change is intended.
3.  For day-to-day intentional changes: run `overkill baseline update`
    to create new baselines and overwrite changed ones. Stale orphans
    stay on disk for now.
4.  When committing a rename or deletion that should also clean up
    stale baselines: run `overkill baseline apply` instead. The diff
    in `test-baselines/` will include both the updates and the
    removals.
5.  `git diff test-baselines/` shows everything that changed. Review
    and commit those files together with the production change that
    caused the update.

The baselines live under version control precisely so step 5 makes
the update reviewable. A baseline change that doesn't fit on a code-
review screen indicates either a too-broad baseline or a too-broad
production change.

### Stale Artifact Handling

Stale baselines (no corresponding collected test) are detected after
the run by comparing the on-disk baseline files against the resolved
case identities. Default policy:

-   ordinary `overkill run`: stale baselines **fail the run**. The
    suite is honest about its on-disk state. (Configurable to a
    warning in `overkill.config.ts` if a project needs a softer
    policy during a transition.)
-   `overkill baseline update`: stale orphans are reported but **left
    on disk** — `update` is non-destructive
-   `overkill baseline apply`: stale orphans are removed after the run
    completes; this is the verb's reason for existing
-   `overkill baseline clean`: stale orphans are removed without
    running tests or touching active baselines

Renames are detected as a stale orphan plus a missing new baseline
(see `non-goals.md` § No automatic rename inference); the developer
accepts both deliberately by running `apply`.

### What The Runner Will Not Do

-   silently update baselines under any verb. The user must type a
    write verb (`update`, `apply`, `bootstrap`, `clean`) for the
    runner to touch baseline files.
-   cross-delete baselines that belong to a different identity-form
    variant (e.g. the same test under a different runtime) — stale
    detection is scoped to identities present in the current run,
    so a baseline for a runtime not selected this run is _not_
    treated as stale and is _not_ removed

These are framed as non-goals to keep the update story honest about
what is and is not automatic.

## Package Position

Generic snapshots should live above the core, primarily in integration-oriented packages or shared baseline utilities. If research later proves that baseline identity or lifecycle must be in the core, that should be documented as a deliberate exception.
